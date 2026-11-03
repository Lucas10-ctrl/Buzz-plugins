/**
 * Build intent for the workspace agent; conversion alone does not complete a website.
 * @param workspaceId - Registered workspace containing the source design.
 * @param designId - Saved design document identity.
 * @param frameId - Top-level artboard to build.
 * @param revision - Saved source revision after any pending edits have been saved.
 * @param host - Builder name and guide loader supplied by the host; omission retains the original host instructions.
 * @returns Website-building instructions naming the exact source and verification requirements.
 */
export function designerWebsiteBuildPrompt(workspaceId: string, designId: string, frameId: string, revision: number,
  host: { builderName: string; loadGuide: string } = { builderName: 'CopyOS Builder', loadGuide: 'Load the canvas-to-website skill before acting.' }): string {
  return `Build this Canvas artboard into a complete working website in ${host.builderName}. ${host.loadGuide}
Workspace ID: ${workspaceId}
Design ID: ${designId}
Artboard ID: ${frameId}
Saved source revision: ${revision}
Read the current saved source and reconcile any revision change. Preserve the original design and create or reuse its linked Builder page. Understand every region and control from visual, structural and interaction evidence; do not require manual semantics annotations. Include responsive desktop, tablet and mobile layouts automatically in the same page. Implement and test evidenced navigation, menus, buttons, tabs, accordions and forms. Never invent external destinations, backend integrations or successful form submissions. Use workspace branding and actual fonts. Native layer conversion is only a starting point: improve the saved editable Builder page and verify all sections at 1440, 768, 390 and 320 pixels, including interaction and overflow checks. Continue until the page is built and verified, or name a concrete blocker. Do not deploy or publish.`
}
