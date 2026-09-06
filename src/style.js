export const GLOBAL_STYLE = String.raw`
  html {
    --btf-card-accent: #006f9e;
    --btf-card-muted: #5f6670;
    --btf-card-text: #18191c;
    --btf-card-action-font-size: 12px;
    --btf-empty-font-size: 14px;
    --btf-card-icon-font-size: 13px;
  }

  html[data-theme="dark"],
  html.bili-dark {
    --btf-card-accent: #4cc9f0;
    --btf-card-muted: #b4bac2;
    --btf-card-text: #f1f2f3;
  }

  #btf-root {
    position: fixed;
    z-index: 2147483000;
    width: 48px;
    height: 48px;
    inset: auto 18px 22px auto;
    pointer-events: none;
  }

  html:not([data-btf-view-mode="hidden"]) .bili-dyn-list__item[data-btf-hidden-reason] {
    display: none !important;
  }

  html[data-btf-view-mode="hidden"] .bili-dyn-list__item:not([data-btf-hidden-reason]) {
    display: none !important;
  }

  .bili-dyn-list__item > .btf-hidden-reason {
    display: none;
  }

  html[data-btf-view-mode="hidden"] .bili-dyn-list__item[data-btf-hidden-reason] > .btf-hidden-reason {
    display: block;
    width: fit-content;
    max-width: calc(100% - 16px);
    margin: 0 0 6px 8px;
    padding: 3px 8px;
    border: 1px solid var(--line_regular, #e3e5e7);
    border-radius: 999px;
    background: var(--bg1, #fff);
    color: var(--btf-card-muted);
    font: 600 var(--btf-card-action-font-size)/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .bili-dyn-list__item > .btf-card-collapse-toggle {
    display: none;
  }

  .bili-dyn-list__item[data-btf-collapsed-reason] > .btf-card-collapse-toggle {
    appearance: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    min-height: 58px;
    padding: 12px 16px;
    border: 1px dashed var(--line_regular, #e3e5e7);
    border-radius: 10px;
    background: var(--bg1, #fff);
    color: var(--btf-card-muted);
    cursor: pointer;
    font: 600 var(--btf-empty-font-size)/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    text-align: center;
  }

  .bili-dyn-list__item[data-btf-collapsed-reason] > .btf-card-collapse-toggle:hover,
  .bili-dyn-list__item[data-btf-collapsed-reason] > .btf-card-collapse-toggle:focus-visible {
    border-color: var(--btf-card-accent);
    color: var(--btf-card-text);
  }

  .bili-dyn-list__item[data-btf-collapsed-reason]:not([data-btf-collapsed-expanded="true"]) > :not(.btf-card-collapse-toggle) {
    display: none !important;
  }

  .bili-dyn-item__header:has(> .btf-card-tools) {
    align-items: center;
  }

  [data-btf-card-tools-host="author"] {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    min-width: 0;
    max-width: 100%;
  }

  [data-btf-card-author-slot="true"] {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .btf-card-tools {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    gap: 4px;
    margin-left: auto;
    margin-right: 6px;
    opacity: 0;
    transform: translateY(-2px);
    transition: opacity 150ms ease, transform 150ms ease;
  }

  .btf-card-tools[data-placement="author"] {
    margin-left: 8px;
    margin-right: 0;
  }

  .bili-dyn-item:hover .btf-card-tools,
  .bili-dyn-item:focus-within .btf-card-tools {
    opacity: 1;
    transform: translateY(0);
  }

  .btf-card-action {
    appearance: none;
    border: 1px solid var(--line_regular, #e3e5e7);
    border-radius: 999px;
    background: var(--bg1, #fff);
    color: var(--text2, #61666d);
    cursor: pointer;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: var(--btf-card-action-font-size);
    line-height: 24px;
    height: 26px;
    padding: 0 9px;
    white-space: nowrap;
  }

  .btf-card-action:hover,
  .btf-card-action:focus-visible,
  .btf-card-action[aria-pressed="true"] {
    border-color: var(--btf-card-accent);
    color: var(--text1, var(--btf-card-text));
  }

  .btf-card-action:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 2px;
  }

  .btf-card-action:disabled {
    opacity: .48;
    cursor: not-allowed;
  }

  .btf-feed-empty {
    box-sizing: border-box;
    margin: 12px 0;
    padding: 26px 20px;
    width: 100%;
    border: 1px dashed var(--line_regular, #e3e5e7);
    border-radius: 10px;
    background: var(--bg1, #fff);
    color: var(--btf-card-muted);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    font-size: var(--btf-empty-font-size);
    line-height: 1.6;
    text-align: center;
  }

  html[data-btf-density="compact"] .bili-dyn-list__item {
    margin-bottom: 8px !important;
  }

  html[data-btf-density="compact"] .bili-dyn-item__main {
    padding-top: 14px !important;
    padding-bottom: 12px !important;
  }

  html[data-btf-width="wide"] .bili-dyn-list,
  html[data-btf-width="wide"] .bili-dyn-up-list {
    box-sizing: border-box;
    width: min(760px, calc(100vw - 48px)) !important;
  }

  html[data-btf-width="wide"] .bili-dyn-item {
    box-sizing: border-box;
    width: 100% !important;
  }

  html[data-btf-focus="true"] .bili-dyn-home--member .bili-dyn-sidebar,
  html[data-btf-focus="true"] .bili-dyn-home--member .bili-dyn-my-info,
  html[data-btf-focus="true"] .bili-dyn-home--member .bili-dyn-live-users {
    display: none !important;
  }

  html[data-btf-focus="true"] .bili-dyn-home--member {
    justify-content: center !important;
  }

  @media (max-width: 720px) {
    .btf-card-tools {
      opacity: 1;
      transform: none;
    }

    .btf-card-action {
      width: 28px;
      padding: 0;
      overflow: hidden;
    }

    .btf-card-action .btf-label { display: none; }
    .btf-card-action .btf-icon { font-size: var(--btf-card-icon-font-size); }
  }

  @media (hover: none), (pointer: coarse) {
    .btf-card-tools {
      opacity: 1;
      transform: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .btf-card-tools { transition: none; }
  }

  @media (prefers-color-scheme: dark) {
    html {
      --btf-card-accent: #4cc9f0;
      --btf-card-muted: #b4bac2;
      --btf-card-text: #f1f2f3;
    }
  }
`;

export const PANEL_STYLE = String.raw`
  :host {
    --accent: #006f9e;
    --accent-soft: #e8f7fc;
    --on-accent: #fff;
    --danger: #c7354b;
    --danger-soft: #fff0f2;
    --on-danger: #fff;
    --warning: #925700;
    --surface: rgba(255, 255, 255, .96);
    --surface-2: #f6f7f8;
    --line: #e3e5e7;
    --text: #18191c;
    --text-2: #61666d;
    --text-3: #5f6670;
    --shadow: 0 18px 55px rgba(20, 35, 50, .18), 0 4px 16px rgba(20, 35, 50, .1);
    color-scheme: light;
    font-size: var(--btf-ui-font-size, 12px);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  }

  :host([data-theme="dark"]) {
    --accent: #4cc9f0;
    --accent-soft: #173844;
    --on-accent: #102a34;
    --danger: #ff8fa0;
    --danger-soft: #43262c;
    --on-danger: #39131a;
    --warning: #ffc45b;
    --surface: rgba(32, 34, 38, .97);
    --surface-2: #292c31;
    --line: #3d4047;
    --text: #f1f2f3;
    --text-2: #c9ccd0;
    --text-3: #91969d;
    --shadow: 0 18px 58px rgba(0, 0, 0, .42), 0 4px 16px rgba(0, 0, 0, .26);
    color-scheme: dark;
  }

  @media (prefers-color-scheme: dark) {
    :host([data-theme="auto"]) {
      --accent: #4cc9f0;
      --accent-soft: #173844;
      --on-accent: #102a34;
      --danger: #ff8fa0;
      --danger-soft: #43262c;
      --on-danger: #39131a;
      --warning: #ffc45b;
      --surface: rgba(32, 34, 38, .97);
      --surface-2: #292c31;
      --line: #3d4047;
      --text: #f1f2f3;
      --text-2: #c9ccd0;
      --text-3: #91969d;
      --shadow: 0 18px 58px rgba(0, 0, 0, .42), 0 4px 16px rgba(0, 0, 0, .26);
      color-scheme: dark;
    }
  }

  *, *::before, *::after { box-sizing: border-box; }

  button, input, textarea, select { font: inherit; }

  .launcher, .panel, .toast { pointer-events: auto; }

  button:focus-visible,
  input:focus-visible,
  textarea:focus-visible,
  select:focus-visible,
  a:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }

  .launcher {
    position: relative;
    display: grid;
    place-items: center;
    width: 48px;
    height: 48px;
    border: 1px solid var(--line);
    border-color: color-mix(in srgb, var(--accent) 40%, var(--line));
    border-radius: 16px;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--accent);
    cursor: pointer;
    font-size: 20px;
    user-select: none;
    backdrop-filter: blur(16px);
    transition: transform 160ms ease, box-shadow 160ms ease;
  }

  .launcher:hover { transform: translateY(-2px); }

  .launcher-icon {
    display: block;
    width: 30px;
    height: 30px;
    flex: 0 0 auto;
    overflow: visible;
    pointer-events: none;
  }

  @media (forced-colors: active) {
    .launcher-icon path { fill: ButtonText; }
  }

  .launcher .badge {
    position: absolute;
    top: -5px;
    right: -5px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    border: 2px solid var(--surface);
    border-radius: 999px;
    background: var(--danger);
    color: var(--on-danger);
    font: 700 10px/14px system-ui, sans-serif;
  }

  .panel {
    position: fixed;
    display: none;
    width: min(340px, calc(100vw - 28px));
    max-height: min(760px, calc(100vh - 34px));
    overflow: hidden;
    border: 1px solid var(--line);
    border-radius: 18px;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text);
    backdrop-filter: blur(20px);
  }

  :host([data-open="true"]) .launcher { display: none; }
  :host([data-open="true"]) .panel { display: flex; flex-direction: column; }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 10px;
    min-height: 58px;
    padding: 10px 12px 10px 16px;
    border-bottom: 1px solid var(--line);
  }

  .brand-mark {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    flex: 0 0 auto;
    border-radius: 10px;
    background: linear-gradient(135deg, #006f9e, #5c4ad1);
    color: #fff;
    font-size: 1.333em;
    font-weight: 800;
    box-shadow: 0 6px 16px rgba(0, 174, 236, .22);
    box-shadow: 0 6px 16px color-mix(in srgb, var(--accent) 28%, transparent);
  }

  .brand { min-width: 0; flex: 1; }
  .brand-title { margin: 0; font-size: 1.25em; line-height: 1.333; font-weight: 750; }
  .brand-status { margin: 1px 0 0; color: var(--text-3); font-size: .917em; line-height: 1.455; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

  .icon-button {
    display: grid;
    place-items: center;
    width: 32px;
    height: 32px;
    padding: 0;
    border: 0;
    border-radius: 9px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    font-size: 1.333em;
  }

  .icon-button:hover { background: var(--surface-2); color: var(--text); }

  .stats {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 7px;
    padding: 11px 13px 7px;
  }

  .stat {
    padding: 8px 7px;
    border-radius: 11px;
    background: var(--surface-2);
    text-align: center;
  }

  .stat-button {
    appearance: none;
    width: 100%;
    border: 0;
    color: var(--text);
    cursor: pointer;
    font: inherit;
  }

  .stat-button:hover:not(:disabled) { box-shadow: inset 0 0 0 1px var(--danger); }
  .stat-button[aria-pressed="true"] { background: var(--danger-soft); box-shadow: inset 0 0 0 1px var(--danger); }
  .stat-button:disabled { cursor: default; opacity: .68; }

  .stat strong { display: block; font-size: 1.333em; line-height: 1.25; font-variant-numeric: tabular-nums; }
  .stat span { color: var(--text-3); font-size: .833em; }
  .stat.hidden strong { color: var(--danger); }
  .stat.unknown strong { color: var(--warning); }

  .scroll-area {
    min-height: 0;
    overflow: auto;
    overscroll-behavior: contain;
    scrollbar-width: thin;
    scrollbar-color: var(--line) transparent;
    padding: 6px 13px 14px;
  }

  .section {
    margin-top: 9px;
    padding-top: 12px;
    border-top: 1px solid var(--line);
  }

  .section:first-child { margin-top: 0; border-top: 0; }
  .section-title { margin: 0; font: inherit; }
  .section-toggle {
    appearance: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-height: 28px;
    padding: 2px 0;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--text-2);
    cursor: pointer;
    text-align: left;
  }
  .section-title-label { min-width: 0; flex: 1; font-size: 1em; font-weight: 700; line-height: 1.4; }
  .section-title-trailing { min-width: 0; max-width: 68%; display: flex; align-items: center; justify-content: flex-end; gap: 9px; }
  .section-hint { min-width: 0; overflow: hidden; color: var(--text-3); font-size: .833em; text-overflow: ellipsis; white-space: nowrap; }
  .section-chevron {
    width: 8px;
    height: 8px;
    flex: 0 0 auto;
    border-right: 2px solid currentColor;
    border-bottom: 2px solid currentColor;
    transform: rotate(45deg);
    transition: transform 180ms ease;
  }
  .section-toggle:hover { color: var(--text); }
  .section-collapse {
    display: grid;
    grid-template-rows: 1fr;
    opacity: 1;
    visibility: visible;
    transition: grid-template-rows 180ms ease, opacity 140ms ease, visibility 0s linear 0s;
  }
  .section-content { min-height: 0; overflow: hidden; }
  .section-content-inner { min-width: 0; padding-top: 9px; }
  .collapsible-section[data-collapsed="true"] .section-collapse {
    grid-template-rows: 0fr;
    opacity: 0;
    visibility: hidden;
    transition: grid-template-rows 180ms ease, opacity 140ms ease, visibility 0s linear 0s;
  }
  .collapsible-section[data-collapsed="true"] .section-hint { display: none; }
  .collapsible-section[data-collapsed="true"] .section-chevron { transform: rotate(-45deg); }

  .switch-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  .switch-copy strong { display: block; font-size: 1.083em; }
  .switch-copy span { display: block; margin-top: 2px; color: var(--text-3); font-size: .833em; }

  .switch {
    position: relative;
    width: 38px;
    height: 22px;
    flex: 0 0 auto;
    border: 0;
    border-radius: 999px;
    background: var(--line);
    cursor: pointer;
    transition: background 160ms ease;
  }

  .switch::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 1px 3px rgba(0,0,0,.22);
    transition: transform 160ms ease;
  }

  .switch[aria-checked="true"] { background: var(--accent); }
  .switch[aria-checked="true"]::after { transform: translateX(16px); }

  .search,
  select {
    width: 100%;
    border: 1px solid var(--line);
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--text);
  }

  .search { min-height: 34px; padding: 0 10px; font-size: 1em; }
  .search::placeholder { color: var(--text-3); }

  .group-gesture-help {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 10px;
    margin: 6px 2px 0;
    color: var(--text-3);
    font-size: .833em;
    line-height: 1.5;
  }

  .group-gesture-help span::before {
    display: inline-block;
    width: 6px;
    height: 6px;
    margin-right: 4px;
    border-radius: 50%;
    background: var(--line);
    content: "";
    vertical-align: 1px;
  }

  .group-gesture-help .include-gesture::before { background: var(--accent); }
  .group-gesture-help .exclude-gesture::before { background: var(--danger); }

  .groups {
    display: grid;
    gap: 6px;
    max-height: 204px;
    margin-top: 8px;
    overflow: auto;
    scrollbar-width: thin;
  }

  .group-row {
    width: 100%;
    appearance: none;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    padding: 5px 8px 5px 10px;
    border: 1px solid transparent;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--text);
    cursor: pointer;
    text-align: left;
    transition: border-color 120ms ease, background-color 120ms ease;
  }

  .group-row[data-state="0"]:hover { border-color: var(--text-3); background: var(--surface); }
  .group-row[data-state="1"] { border-color: var(--accent); background: var(--accent-soft); }
  .group-row[data-state="-1"] { border-color: var(--danger); background: var(--danger-soft); }
  .group-row.loading { cursor: progress; }
  .group-row.loading[data-state="0"] { border-color: var(--accent); }
  .group-row[data-state="-1"]:focus-visible { outline-color: var(--danger); }
  .group-name { min-width: 0; }
  .group-name strong { display: block; overflow: hidden; color: var(--text); font-size: 1em; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
  .group-name span { color: var(--text-3); font-size: .833em; }

  .group-state {
    min-width: 42px;
    padding: 3px 7px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface) 76%, transparent);
    color: var(--text-3);
    font-size: .833em;
    font-weight: 650;
    text-align: center;
  }

  .group-row[data-state="1"] .group-state { color: var(--accent); }
  .group-row[data-state="-1"] .group-state { color: var(--danger); }

  .empty-groups { padding: 18px 8px; color: var(--text-3); font-size: 1em; text-align: center; }

  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    height: 28px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 999px;
    background: var(--surface);
    color: var(--text-2);
    cursor: pointer;
    font-size: .917em;
  }

  .chip[aria-pressed="true"] { border-color: var(--danger); background: var(--danger-soft); color: var(--danger); }

  .inline-check { display: inline-flex; align-items: center; gap: 6px; margin-top: 7px; color: var(--text-2); font-size: .917em; }
  .inline-check input { accent-color: var(--accent); }

  .promotion-options { display: grid; gap: 10px; }
  .promotion-option + .promotion-option { padding-top: 10px; border-top: 1px solid var(--line); }
  .suspicious-field { padding-top: 2px; }
  .promotion-note { margin: -2px 1px 0; color: var(--text-3); font-size: .833em; line-height: 1.5; }

  .settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .field span { display: block; margin: 0 0 4px 2px; color: var(--text-3); font-size: .833em; }
  .field select { min-height: 32px; padding: 0 8px; font-size: .917em; }

  :host([data-font-size="large"]) .settings-grid { grid-template-columns: 1fr; }

  .font-toolbar {
    display: grid;
    grid-template-areas: "label label label value" "minus slider plus value";
    grid-template-columns: 32px minmax(72px, 1fr) 32px auto;
    align-items: center;
    gap: 6px;
    margin-top: 10px;
    padding: 8px;
    border: 1px solid var(--line);
    border-radius: 11px;
    background: var(--surface-2);
  }

  .font-toolbar-label { grid-area: label; color: var(--text-3); font-size: .833em; }
  .font-decrease { grid-area: minus; }
  .font-scale { grid-area: slider; width: 100%; min-width: 0; accent-color: var(--accent); cursor: pointer; }
  .font-increase { grid-area: plus; }
  .font-reset { grid-area: value; align-self: stretch; min-width: 47px; }
  .font-step,
  .font-reset {
    min-height: 30px;
    padding: 0 7px;
    border: 1px solid var(--line);
    border-radius: 8px;
    background: var(--surface);
    color: var(--text-2);
    cursor: pointer;
    font-size: .917em;
  }
  .font-step:hover,
  .font-reset:hover { border-color: var(--accent); color: var(--accent); }
  .font-step:disabled,
  .font-reset:disabled { opacity: .48; cursor: default; }
  .font-scale-value { font-variant-numeric: tabular-nums; }

  .actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
  .button {
    min-height: 31px;
    padding: 0 10px;
    border: 1px solid var(--line);
    border-radius: 9px;
    background: var(--surface);
    color: var(--text-2);
    cursor: pointer;
    font-size: .917em;
  }

  .button:hover { border-color: var(--accent); color: var(--accent); }
  .button.primary { border-color: var(--accent); background: var(--accent); color: var(--on-accent); }
  .button.danger:hover { border-color: var(--danger); color: var(--danger); }
  .button:disabled { opacity: .5; cursor: wait; }

  .panel-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 43px;
    padding: 7px 13px;
    border-top: 1px solid var(--line);
    color: var(--text-3);
    font-size: .833em;
  }

  .footer-link { border: 0; background: transparent; color: var(--accent); cursor: pointer; font-size: .833em; }

  .drawer {
    position: absolute;
    inset: 0;
    z-index: 3;
    display: none;
    flex-direction: column;
    background: var(--surface);
  }

  .drawer.open { display: flex; }
  .drawer-header { display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 10px 12px 10px 16px; border-bottom: 1px solid var(--line); }
  .drawer-header h2 { flex: 1; margin: 0; font-size: 1.25em; }
  .watch-list { flex: 1; overflow: auto; padding: 10px 12px; }
  .watch-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; padding: 10px 4px; border-bottom: 1px solid var(--line); }
  .watch-item a { overflow: hidden; color: var(--text); font-size: 1em; font-weight: 600; text-decoration: none; text-overflow: ellipsis; white-space: nowrap; }
  .watch-item a:hover { color: var(--accent); }
  .watch-meta { margin-top: 4px; overflow: hidden; color: var(--text-3); font-size: .833em; text-overflow: ellipsis; white-space: nowrap; }
  .watch-remove { align-self: center; border: 0; background: transparent; color: var(--text-3); cursor: pointer; font-size: 1.333em; }
  .watch-remove:hover { color: var(--danger); }
  .watch-empty { padding: 48px 12px; color: var(--text-3); font-size: 1em; line-height: 1.7; text-align: center; }

  .toast {
    position: absolute;
    right: 0;
    bottom: 58px;
    display: none;
    align-items: center;
    gap: 9px;
    max-width: 300px;
    padding: 9px 10px 9px 12px;
    border: 1px solid var(--line);
    border-radius: 11px;
    background: var(--surface);
    box-shadow: var(--shadow);
    color: var(--text-2);
    font-size: .917em;
  }

  :host([data-edge-x="left"]) .toast { left: 0; right: auto; }
  :host([data-edge-y="top"]) .toast { top: 58px; bottom: auto; }
  .toast.show { display: flex; }
  .toast button { border: 0; background: transparent; color: var(--accent); cursor: pointer; }

  @media (max-width: 720px) {
    .groups { max-height: 180px; }
    .toast { position: fixed; left: 14px !important; right: 14px !important; top: auto !important; bottom: 76px; max-width: none; }
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { scroll-behavior: auto !important; transition-duration: .01ms !important; }
  }
`;
