/** Application chrome comes from the host; editor geometry and content stay with the original apps. */
import {
  createContext,
  useContext,
  type ButtonHTMLAttributes,
  type ComponentType,
  type ReactNode,
  type Ref,
  type KeyboardEventHandler,
} from "react";

export interface EditorChrome {
  readonly Button: ComponentType<
    Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> & {
      readonly children: ReactNode;
      readonly variant?: "prominent" | "ghost" | "subtle" | "outline";
      readonly size?: "sm" | "xs";
    }
  >;
  readonly DocumentIcon: ComponentType<{ readonly size: number }>;
  readonly PlusIcon: ComponentType<{ readonly size: number }>;
  readonly BuilderModeIcon: ComponentType<{
    readonly mode: "new" | "strategy" | "clone" | "existing";
    readonly size: number;
  }>;
  readonly ActionMenu: ComponentType<EditorActionMenuProps>;
  readonly PagePicker: ComponentType<EditorPagePickerProps>;
  readonly TextField: ComponentType<EditorTextFieldProps>;
  readonly Select: ComponentType<EditorSelectProps>;
  readonly Checkbox: ComponentType<EditorCheckboxProps>;
  readonly ReviewDialog: ComponentType<EditorReviewDialogProps>;
  readonly VersionItem: ComponentType<EditorVersionItemProps>;
  readonly NavigationGroup: ComponentType<{
    readonly label: string;
    readonly children: ReactNode;
  }>;
}

/** Page navigation and adjacent creation/import actions use the host's menu and icon controls. */
export interface EditorPagePickerProps {
  readonly label: string;
  readonly value: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly disabled: boolean;
  readonly onValueChange: (value: string) => void;
  readonly actions: readonly {
    readonly label: string;
    readonly disabled: boolean;
    readonly danger?: boolean;
    readonly onSelect: () => void;
  }[];
  readonly newLabel: string;
  readonly importLabel: string;
  readonly actionsDisabled: boolean;
  readonly onNew?: (() => void) | undefined;
  readonly onImport?: (() => void) | undefined;
}

/** The host supplies field labelling, text controls and their focus treatment. */
export interface EditorTextFieldProps {
  readonly type?: "text" | "password";
  readonly label: string;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly placeholder?: string;
  readonly rows?: number;
  readonly id?: string;
  readonly labelAction?: ReactNode;
  readonly maxLength?: number;
  readonly disabled?: boolean;
  readonly labelVisibility?: "visible" | "hidden";
  readonly textareaRef?: Ref<HTMLTextAreaElement>;
  readonly onTextareaKeyDown?: KeyboardEventHandler<HTMLTextAreaElement>;
}

/** A comparison dialog with host-owned framing, scrollports, dismissal and focus. */
export interface EditorReviewDialogProps {
  readonly title: string;
  readonly description: string;
  readonly closeLabel: string;
  readonly navigationLabel: string;
  readonly navigation: ReactNode;
  readonly children: ReactNode;
  readonly actions: ReactNode;
  readonly hint: string;
  readonly busy: boolean;
  readonly onClose: () => void;
}

/** Original version metadata within the host's selectable navigation row. */
export interface EditorVersionItemProps {
  readonly label: string;
  readonly dateTime: string;
  readonly dateLabel: string;
  readonly currentLabel?: string;
  readonly restoredLabel?: string;
  readonly selected: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
}

/** The host owns choice popup, keyboard selection and field labelling. */
export interface EditorSelectProps {
  readonly disabled?: boolean;
  readonly label: string;
  readonly value: string;
  readonly options: readonly {
    readonly value: string;
    readonly label: string;
  }[];
  readonly onValueChange: (value: string) => void;
}

/** A labelled boolean control using the host's actual checkbox. */
export interface EditorCheckboxProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onCheckedChange: (checked: boolean) => void;
}

/** The host owns menu positioning, keyboard navigation, dismissal and trigger appearance. */
export interface EditorActionMenuProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly label: string;
  readonly ariaLabel: string;
  readonly groups: readonly {
    readonly label: string;
    readonly items: readonly {
      readonly label: string;
      readonly disabled?: boolean;
      readonly onSelect: () => void;
    }[];
  }[];
}
const Chrome = createContext<EditorChrome | null>(null);

/** Supply the host's shared controls without importing its application into the editor library. */
export function EditorChromeProvider({
  value,
  children,
}: {
  readonly value: EditorChrome;
  readonly children: ReactNode;
}) {
  return <Chrome.Provider value={value}>{children}</Chrome.Provider>;
}

/** Require the host implementation instead of silently falling back to another application's controls. */
export function useEditorChrome(): EditorChrome {
  const chrome = useContext(Chrome);
  if (!chrome)
    throw new Error(
      "EditorChromeProvider is required for editor application controls",
    );
  return chrome;
}
