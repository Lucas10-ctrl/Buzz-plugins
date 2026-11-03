import { Fragment, type ChangeEvent } from "react";
import { Button } from "../../../shared/design-system/ui/Button";
import { IconButton } from "../../../shared/design-system/ui/IconButton";
import { Field } from "../../../shared/design-system/ui/Field";
import { Input } from "../../../shared/design-system/ui/Input";
import { Textarea } from "../../../shared/design-system/ui/Textarea";
import { Select } from "../../../shared/design-system/ui/Select";
import { Checkbox } from "../../../shared/design-system/ui/Checkbox";
import { Dialog } from "../../../shared/design-system/ui/Dialog";
import { NavigationItem } from "../../../shared/design-system/ui/NavigationItem";
import { NavigationSection } from "../../../shared/design-system/ui/NavigationSection";
import { SidebarNavigation } from "../../../shared/design-system/ui/SidebarNavigation";
import {
  MenuRoot,
  MenuTrigger,
  MenuPopup,
  MenuGroup,
  MenuGroupLabel,
  MenuItem,
  MenuSeparator,
  MenuRadioGroup,
  MenuRadioItem,
} from "../../../shared/design-system/ui/Menu";
import {
  FileTextIcon,
  PlusIcon,
  DownloadIcon,
  CaretDownIcon,
  CloudUploadIcon,
  FilePlusIcon,
  GlobeIcon,
  FolderOpenIcon,
} from "../../../shared/design-system/icons";
import type {
  EditorChrome,
  EditorActionMenuProps,
  EditorTextFieldProps,
  EditorPagePickerProps,
} from "../../../../portable/copyos-apps/dist/types/copyos-apps/src/index";

/** Keep page choices and management in one native menu, with separate creation/import triggers. */
export function EditorPagePicker({
  label,
  value,
  options,
  disabled,
  onValueChange,
  actions,
  newLabel,
  importLabel,
  actionsDisabled,
  onNew,
  onImport,
}: EditorPagePickerProps) {
  return (
    <>
      <MenuRoot>
        <MenuTrigger
          render={
            <Button
              variant="subtle"
              size="sm"
              aria-label={label}
              disabled={disabled}
              title={options.find((option) => option.value === value)?.label}
            >
              <FileTextIcon size={16} />
              <span className="truncate max-w-48">
                {options.find((option) => option.value === value)?.label ??
                  label}
              </span>
              <CaretDownIcon size={12} />
            </Button>
          }
        />
        <MenuPopup align="start">
          <MenuRadioGroup value={value} onValueChange={onValueChange}>
            {options.map((option) => (
              <MenuRadioItem
                key={option.value}
                value={option.value}
                closeOnClick
              >
                {option.label}
              </MenuRadioItem>
            ))}
          </MenuRadioGroup>
          {actions.length ? <MenuSeparator /> : null}
          {actions.map((action) => (
            <MenuItem
              key={action.label}
              disabled={action.disabled}
              tone={action.danger ? "danger" : "default"}
              onClick={action.onSelect}
            >
              {action.label}
            </MenuItem>
          ))}
        </MenuPopup>
      </MenuRoot>
      {onNew ? (
        <IconButton
          aria-label={newLabel}
          title={newLabel}
          hint="familiar"
          icon={<PlusIcon size={16} />}
          disabled={actionsDisabled}
          onClick={onNew}
        />
      ) : null}
      {onImport ? (
        <IconButton
          aria-label={importLabel}
          title={importLabel}
          icon={<CloudUploadIcon size={16} />}
          disabled={actionsDisabled}
          onClick={onImport}
        />
      ) : null}
    </>
  );
}

/** Retain the original field and adjacent file action using Buzz's shared label and control owners. */
function EditorTextField({
  type = "text",
  label,
  value,
  onValueChange,
  placeholder,
  rows,
  id,
  labelAction,
  maxLength,
  disabled,
  labelVisibility = "visible",
  textareaRef,
  onTextareaKeyDown,
}: EditorTextFieldProps) {
  const props = {
    id,
    value,
    placeholder,
    maxLength,
    disabled,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onValueChange(event.currentTarget.value),
  };
  return (
    <Field
      label={label}
      labelVisibility={labelVisibility}
      style={
        labelAction
          ? { gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center" }
          : undefined
      }
    >
      {labelAction}
      {rows === undefined ? (
        <Input
          {...props}
          type={type}
          autoComplete={type === "password" ? "off" : undefined}
        />
      ) : (
        <Textarea
          {...props}
          ref={textareaRef}
          onKeyDown={onTextareaKeyDown}
          rows={rows}
          style={labelAction ? { gridColumn: "1 / -1" } : undefined}
        />
      )}
    </Field>
  );
}

/** Original action groups use Buzz's own menu activation, focus, portal and dismissal behavior. */
export function EditorActionMenu({
  open,
  onOpenChange,
  label,
  ariaLabel,
  groups,
}: EditorActionMenuProps) {
  return (
    <MenuRoot open={open} onOpenChange={onOpenChange}>
      <MenuTrigger
        render={
          <Button variant="prominent" size="sm" aria-label={ariaLabel}>
            <DownloadIcon size={16} />
            {label}
            <CaretDownIcon size={12} />
          </Button>
        }
      />
      <MenuPopup align="end">
        {groups.map((group, index) => (
          <Fragment key={group.label}>
            {index ? <MenuSeparator /> : null}
            <MenuGroup>
              <MenuGroupLabel>{group.label}</MenuGroupLabel>
              {group.items.map((item) => (
                <MenuItem
                  key={item.label}
                  disabled={item.disabled}
                  onClick={item.onSelect}
                >
                  {item.label}
                </MenuItem>
              ))}
            </MenuGroup>
          </Fragment>
        ))}
      </MenuPopup>
    </MenuRoot>
  );
}

/** Shared Buzz controls injected into the retained editor views, without a second design system. */
export const nativeEditorChrome: EditorChrome = {
  Button,
  PagePicker: EditorPagePicker,
  DocumentIcon: ({ size }) => <FileTextIcon size={size} />,
  PlusIcon: ({ size }) => <PlusIcon size={size} />,
  BuilderModeIcon: ({ mode, size }) => {
    const Icon = {
      new: FilePlusIcon,
      strategy: FileTextIcon,
      clone: GlobeIcon,
      existing: FolderOpenIcon,
    }[mode];
    return <Icon size={size} />;
  },
  ActionMenu: EditorActionMenu,
  TextField: EditorTextField,
  Select: ({ label, value, options, onValueChange, disabled = false }) => (
    <Select
      label={label}
      value={value}
      groups={[{ label, options }]}
      onValueChange={onValueChange}
      variant="field"
      disabled={disabled}
    />
  ),
  Checkbox: ({ label, checked, onCheckedChange }) => (
    <Checkbox
      label={label}
      checked={checked}
      onCheckedChange={onCheckedChange}
    />
  ),
  ReviewDialog: ({
    title,
    description,
    closeLabel,
    navigationLabel,
    navigation,
    children,
    actions,
    hint,
    busy,
    onClose,
  }) => (
    <Dialog
      open
      title={title}
      description={description}
      closeLabel={closeLabel}
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
      preventClose={busy}
      navigation={{
        label: navigationLabel,
        content: <SidebarNavigation>{navigation}</SidebarNavigation>,
      }}
      bodyLayout="flex"
      actions={actions}
      leadingActions={<p className="text-body-sm text-subtle">{hint}</p>}
    >
      {children}
    </Dialog>
  ),
  VersionItem: ({
    label,
    dateTime,
    dateLabel,
    currentLabel,
    restoredLabel,
    selected,
    disabled,
    onSelect,
  }) => (
    <NavigationItem
      multiline
      selected={selected}
      aria-current={selected ? "true" : undefined}
      disabled={disabled}
      onClick={onSelect}
      label={
        <span className="grid gap-1">
          <span className="text-body-sm font-medium">{label}</span>
          <time dateTime={dateTime} className="text-metadata text-subtle">
            {dateLabel}
          </time>
          {currentLabel && (
            <span className="text-metadata text-subtle">{currentLabel}</span>
          )}
          {restoredLabel && (
            <span className="text-metadata text-subtle">{restoredLabel}</span>
          )}
        </span>
      }
    />
  ),
  NavigationGroup: ({ label, children }) => (
    <NavigationSection label={label}>{children}</NavigationSection>
  ),
};
