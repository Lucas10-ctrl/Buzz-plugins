import { useEffect, useId, type RefObject } from "react";
import type { PageAssetView } from "./PagePreviewAssets.ts";
import {
  installPreviewFonts,
  PREVIEW_FONT_MARKER,
  type PreviewFontFace,
} from "./PagePreviewFonts.ts";

export type PreviewFontReport = (
  owner: string,
  errors: readonly string[],
) => void;

/** Follow the iframe's own document/load lifetime rather than registering fonts in Buzz's document. */
export function usePagePreviewFonts(
  frame: RefObject<HTMLIFrameElement>,
  assets: PageAssetView | undefined,
  report: PreviewFontReport,
): void {
  const owner = useId();
  useEffect(() => {
    const element = frame.current;
    if (!element || !assets) return;
    let controller: AbortController | undefined;
    let removeConditions = () => {};
    const configure = () => {
      controller?.abort();
      removeConditions();
      report(owner, []);
      const document = element.contentDocument;
      if (document?.readyState !== "complete") return;
      const ids = new Set(
        [...document.querySelectorAll("style")].flatMap((style) =>
          [...(style.textContent ?? "").matchAll(PREVIEW_FONT_MARKER)].map(
            (match) => match[1] ?? "",
          ),
        ),
      );
      const faces = [...ids]
        .map((id) => assets.fontFaces.get(id))
        .filter((face): face is PreviewFontFace => face !== undefined);
      if (!faces.length) return;
      const current = new AbortController();
      controller = current;
      void installPreviewFonts(document, faces, current.signal).then(
        (errors) => {
          if (!current.signal.aborted && element.contentDocument === document)
            report(owner, errors);
        },
      );
      const queries = [
        ...new Set(
          faces.flatMap((face) =>
            face.conditions
              .filter((condition) => condition.kind === "media")
              .map((condition) => condition.value),
          ),
        ),
      ];
      const media = queries
        .map((query) => document.defaultView?.matchMedia(query))
        .filter((query): query is MediaQueryList => query !== undefined);
      for (const query of media) query.addEventListener("change", configure);
      removeConditions = () => {
        for (const query of media)
          query.removeEventListener("change", configure);
      };
    };
    element.addEventListener("load", configure);
    configure();
    return () => {
      element.removeEventListener("load", configure);
      controller?.abort();
      removeConditions();
      report(owner, []);
    };
  }, [frame, assets, owner, report]);
}
