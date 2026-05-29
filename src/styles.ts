import { css } from "lit";

// We set font-size to 16px and all the mdc typography styles
// because it defaults to rem, which means that the font-size
// of the host website would influence the ESP Web Tools dialog.

export const dialogStyles = css`
  :host {
    --hsl-font: 'Open Sans', 'Helvetica Neue', Helvetica, Arial, sans-serif;
    --text-color: rgba(255, 255, 255, 0.87);
    --danger-color: #ff5252;

    /* HSL accent: cyan gradient → single token */
    --md-sys-color-primary: #00d3ff;
    --md-sys-color-on-primary: #001a22;

    --md-ref-typeface-brand: var(--hsl-font);
    --md-ref-typeface-plain: var(--hsl-font);

    /* Dialog surfaces — dark theme */
    --md-sys-color-surface: #1a1a2e;
    --md-sys-color-surface-container: #1a1a2e;
    --md-sys-color-surface-container-high: #22223a;
    --md-sys-color-surface-container-highest: #2a2a42;
    --md-sys-color-secondary-container: #2a2a42;

    /* Text on surfaces */
    --md-sys-color-on-surface: rgba(255, 255, 255, 0.87);
    --md-sys-color-on-surface-variant: rgba(255, 255, 255, 0.55);
    --md-sys-color-outline: rgba(255, 255, 255, 0.15);
    --md-sys-color-outline-variant: rgba(255, 255, 255, 0.08);

    --md-sys-typescale-headline-font: var(--hsl-font);
    --md-sys-typescale-title-font: var(--hsl-font);
    --md-sys-typescale-body-font: var(--hsl-font);
    --md-sys-typescale-label-font: var(--hsl-font);
  }

  a {
    color: var(--md-sys-color-primary);
  }
`;
