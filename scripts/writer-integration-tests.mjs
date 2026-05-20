import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "writer-integration-"));
const readerDataDir = path.join(tmpRoot, "reader");
const writerDataDir = path.join(tmpRoot, "writer");

fs.mkdirSync(readerDataDir, { recursive: true });
fs.mkdirSync(writerDataDir, { recursive: true });
seedPreContextWriterDb(writerDataDir);

const server = await startServer();

try {
  await test("writer schema startup adds context artifact table to an existing writer DB", async () => {
    const writerDb = new DatabaseSync(path.join(writerDataDir, "writer.db"), { readOnly: true });
    try {
      const table = writerDb
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'writer_context_artifacts'")
        .get();
      assert.ok(table, "writer_context_artifacts table should exist after startup");

      const columns = writerDb.prepare("PRAGMA table_info(writer_context_artifacts)").all();
      assert.ok(columns.some((column) => column.name === "stale_after_edit_count"));
      assert.ok(columns.some((column) => column.name === "stale_after_seconds"));
    } finally {
      writerDb.close();
    }
  });

  await test("writer document, revision, context, assist, and suggestion endpoints", async () => {
    const created = await expectOk("/api/writer/documents", {
      method: "POST",
      body: JSON.stringify({
        title: "Milestone 6 Draft",
        genre: "Essay",
        audience: "Graduate seminar",
        target_length: 900
      })
    });
    assert.equal(created.document.title, "Milestone 6 Draft");

    const fullText = [
      "# Transit Policy",
      "",
      "This essay argues that very broad transit policy matters because cities need clearer choices.",
      "",
      "A lot of stuff changes when bus lanes, housing, and schedules are planned together."
    ].join("\n");
    const initialEdit = await expectOk(`/api/writer/documents/${created.document.id}/edits`, {
      method: "POST",
      body: JSON.stringify({
        base_revision_id: null,
        operations: [{ op_type: "insert", range_start: 0, range_end: 0, inserted_text: fullText }],
        change_summary: "Initial draft."
      })
    });
    assert.equal(initialEdit.latest_revision.revision_number, 1);
    assert.ok(initialEdit.blocks.length >= 3);

    const fetched = await expectOk(`/api/writer/documents/${created.document.id}`);
    assert.equal(fetched.latest_revision.id, initialEdit.latest_revision.id);
    assert.equal(fetched.blocks.length, initialEdit.blocks.length);

    const context = await expectOk(`/api/writer/documents/${created.document.id}/context/update`, {
      method: "POST",
      body: JSON.stringify({ force: true })
    });
    assert.deepEqual(context.generated_artifact_types.sort(), ["document_outline", "recent_changes", "thesis_state"].sort());
    assert.equal(context.artifacts.length, 3);

    const assist = await expectOk(`/api/writer/documents/${created.document.id}/assist`, {
      method: "POST",
      body: JSON.stringify({
        prompt: "Find the highest-value line edits.",
        base_revision_id: initialEdit.latest_revision.id,
        use_llm: false,
        max_suggestions: 3
      })
    });
    assert.equal(assist.provider, "local");
    assert.ok(assist.suggestions.length >= 2, "local coach should produce at least two suggestions for the fixture text");

    await waitFor(() => server.output.includes('"event":"context_assembly"'));
    assert.match(server.output, /"latency_ms":\d+/);
    assert.match(server.output, /"approx_payload_tokens":\d+/);

    const [firstSuggestion, secondSuggestion] = assist.suggestions;
    const applied = await expectOk(`/api/writer/documents/${created.document.id}/suggestions/${firstSuggestion.id}/apply`, {
      method: "POST",
      body: JSON.stringify({
        base_revision_id: initialEdit.latest_revision.id,
        resolution_note: "Accepted in integration test."
      })
    });
    assert.equal(applied.suggestion.status, "accepted");
    assert.equal(applied.latest_revision.revision_number, 2);

    const rejected = await expectOk(`/api/writer/documents/${created.document.id}/suggestions/${secondSuggestion.id}/reject`, {
      method: "POST",
      body: JSON.stringify({ resolution_note: "Rejected in integration test." })
    });
    assert.equal(rejected.suggestion.status, "rejected");

    const revisions = await expectOk(`/api/writer/documents/${created.document.id}/revisions?limit=10`);
    assert.equal(revisions.revisions[0].revision_number, 2);
    assert.ok(revisions.revisions.some((revision) => revision.id === initialEdit.latest_revision.id));

    const acceptedSuggestions = await expectOk(`/api/writer/documents/${created.document.id}/suggestions?status=accepted`);
    assert.ok(acceptedSuggestions.suggestions.some((suggestion) => suggestion.id === firstSuggestion.id));
    const rejectedSuggestions = await expectOk(`/api/writer/documents/${created.document.id}/suggestions?status=rejected`);
    assert.ok(rejectedSuggestions.suggestions.some((suggestion) => suggestion.id === secondSuggestion.id));

    const staleBase = await request(`/api/writer/documents/${created.document.id}/edits`, {
      method: "POST",
      body: JSON.stringify({
        base_revision_id: initialEdit.latest_revision.id,
        operations: [{ op_type: "insert", range_start: 0, range_end: 0, inserted_text: "Stale " }]
      })
    });
    assert.equal(staleBase.status, 409);
    assert.match(staleBase.data.error, /base_revision_id/);

    const invalidRange = await request(`/api/writer/documents/${created.document.id}/edits`, {
      method: "POST",
      body: JSON.stringify({
        base_revision_id: applied.latest_revision.id,
        operations: [{ op_type: "replace", range_start: 0, range_end: applied.latest_revision.full_text.length + 100, inserted_text: "Nope" }]
      })
    });
    assert.equal(invalidRange.status, 400);
    assert.match(invalidRange.data.error, /range_end exceeds/);
  });
} finally {
  await server.stop();
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}

async function startServer() {
  const port = await findOpenPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let output = "";
  const child = spawn(process.execPath, ["--import", "tsx", "src/backend/server.ts"], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      NODE_ENV: "test",
      NODE_OPTIONS: "--no-warnings=ExperimentalWarning",
      STUDYREADER_DATA_DIR: readerDataDir,
      STUDYWRITER_DATA_DIR: writerDataDir,
      STUDYREADER_PUBLIC: "",
      STUDYREADER_USER: "",
      STUDYREADER_PASSWORD: ""
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  await waitFor(async () => {
    if (child.exitCode !== null) {
      throw new Error(`server exited before startup\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/writer/documents?page_size=1`);
      await response.arrayBuffer().catch(() => undefined);
      return response.ok;
    } catch {
      return false;
    }
  }, 8_000);

  return {
    baseUrl,
    get output() {
      return output;
    },
    get exitCode() {
      return child.exitCode;
    },
    get signalCode() {
      return child.signalCode;
    },
    async stop() {
      if (child.exitCode !== null) return;
      child.kill("SIGTERM");
      await Promise.race([
        once(child, "exit"),
        new Promise((resolve) => setTimeout(resolve, 2_000))
      ]);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  };
}

async function expectOk(pathname, options) {
  const response = await request(pathname, options);
  assert.ok(
    response.status >= 200 && response.status < 300,
    `${pathname} expected 2xx but received ${response.status}: ${JSON.stringify(response.data)}`
  );
  return response.data;
}

async function request(pathname, options = {}) {
  let response;
  try {
    response = await fetch(`${server.baseUrl}${pathname}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers
      }
    });
  } catch (error) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    const cause = error instanceof Error && "cause" in error ? error.cause : null;
    throw new Error(
      `Fetch failed for ${pathname}\nServer exit: ${server.exitCode ?? "running"} ${server.signalCode ?? ""}\n${server.output}\n${error instanceof Error ? error.stack : String(error)}\nCause: ${String(cause)}`
    );
  }
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  return { status: response.status, data };
}

async function waitFor(predicate, timeoutMs = 4_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      if (await predicate()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (lastError) throw lastError;
  throw new Error("Timed out waiting for condition.");
}

async function findOpenPort() {
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", resolve);
  });
  const address = probe.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error("Could not allocate test server port.");
  return port;
}

function seedPreContextWriterDb(dataDir) {
  const db = new DatabaseSync(path.join(dataDir, "writer.db"));
  try {
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        genre TEXT,
        audience TEXT,
        target_length INTEGER,
        status TEXT NOT NULL DEFAULT 'draft',
        latest_revision_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS document_blocks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        block_index INTEGER NOT NULL,
        block_type TEXT NOT NULL,
        text TEXT NOT NULL,
        start_offset INTEGER NOT NULL,
        end_offset INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS document_revisions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        revision_number INTEGER NOT NULL,
        full_text TEXT NOT NULL,
        outline_json TEXT,
        thesis_json TEXT,
        change_summary TEXT,
        parent_revision_id TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
        FOREIGN KEY(parent_revision_id) REFERENCES document_revisions(id) ON DELETE SET NULL,
        UNIQUE(document_id, revision_number)
      );

      CREATE TABLE IF NOT EXISTS document_edits (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        base_revision_id TEXT,
        result_revision_id TEXT,
        op_type TEXT NOT NULL,
        range_start INTEGER NOT NULL,
        range_end INTEGER NOT NULL,
        inserted_text TEXT NOT NULL,
        deleted_text TEXT NOT NULL,
        block_id TEXT,
        rationale TEXT,
        source TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL,
        FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE,
        FOREIGN KEY(base_revision_id) REFERENCES document_revisions(id) ON DELETE SET NULL,
        FOREIGN KEY(result_revision_id) REFERENCES document_revisions(id) ON DELETE SET NULL,
        FOREIGN KEY(block_id) REFERENCES document_blocks(id) ON DELETE SET NULL
      );
    `);
  } finally {
    db.close();
  }
}
