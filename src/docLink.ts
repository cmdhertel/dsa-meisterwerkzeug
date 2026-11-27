/** Public guide to the expected vault structure (note types, folders, frontmatter). */
export const VAULT_DOC_URL = "https://github.com/cmdhertel/dsa-meisterwerkzeug/blob/main/docs/VAULT.md";

/** Appends a link to the vault guide to an empty-state element, so first-time users learn which notes a view expects. */
export function appendVaultDocLink(el: HTMLElement): void {
  el.appendText(" ");
  el.createEl("a", { text: "Anleitung zum Vault-Aufbau", href: VAULT_DOC_URL });
}
