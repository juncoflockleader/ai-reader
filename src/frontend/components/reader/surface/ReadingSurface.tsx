// Shared scroll frame for the reader. PDF (Phase 1) and Markdown (Phase 3)
// render their content inside this so chrome — scroll container, padding,
// typography preset class — is identical across document types.
//
// Reuses the existing `.pdf-scroll-frame` / `.pdf-scroll` global classes so the
// proven layout/scroll styling applies unchanged. `frameOverlay` renders inside
// the frame but outside the scroll container — used for the reading ruler and
// the area-capture hint, which must stay fixed while the pages scroll.

import { forwardRef, type ReactNode, type Ref } from "react";

type ReadingSurfaceProps = {
  scrollRef: Ref<HTMLDivElement>;
  typography?: "compact" | "comfortable" | "focused";
  children: ReactNode;
  frameOverlay?: ReactNode;
};

function ReadingSurface(
  { scrollRef, typography = "comfortable", children, frameOverlay }: ReadingSurfaceProps,
  frameRef: Ref<HTMLDivElement>
) {
  return (
    <div className={`pdf-scroll-frame ${typography}`} ref={frameRef}>
      <div className="pdf-scroll" ref={scrollRef}>
        {children}
      </div>
      {frameOverlay}
    </div>
  );
}

export default forwardRef(ReadingSurface);
