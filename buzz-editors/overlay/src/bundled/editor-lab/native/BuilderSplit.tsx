import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { ResizeHandle } from "../../../features/panels/ResizeHandle";
import styles from "./native-apps.module.css";

/** Keeps the original editor and Buzz conversation mounted while their divider moves. */
export function BuilderSplit({
  conversation,
  children,
}: {
  conversation: ReactNode;
  children: ReactNode;
}) {
  const target = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState(0);
  const [preferred, setPreferred] = useState<number>();
  useEffect(() => {
    const element = target.current;
    if (!element) return;
    const measure = () => setAvailable(element.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const min = 288;
  const max = Math.max(min, available - 320);
  const clamp = (value: number) => Math.max(min, Math.min(max, value));
  const width = clamp(preferred ?? available * 0.4);
  return (
    <div
      ref={target}
      className={`${styles.workspace} ${styles.builderWorkspace}`}
      style={{ "--builder-chat-width": `${width}px` } as CSSProperties}
    >
      {conversation}
      <ResizeHandle
        label="Resize chat and Page Builder"
        width={width}
        min={min}
        max={max}
        setWidth={(value) => setPreferred(clamp(value))}
        reset={() => setPreferred(undefined)}
        target={target}
        property="--builder-chat-width"
        className={styles.builderDivider}
      />
      {children}
    </div>
  );
}
