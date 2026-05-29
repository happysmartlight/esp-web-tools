import { LitElement, html, PropertyValues, css, TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import "./components/ew-text-button";
import "./components/ew-list";
import "./components/ew-list-item";
import "./components/ew-divider";
import "./components/ew-checkbox";
import "./components/ewt-console";
import "./components/ew-dialog";
import "./components/ew-icon-button";
import "./components/ew-filled-text-field";
import type { EwFilledTextField } from "./components/ew-filled-text-field";
import "./components/ew-filled-select";
import "./components/ew-select-option";
import "./pages/ewt-page-progress";
import "./pages/ewt-page-message";
import {
  closeIcon,
  listItemConsole,
  listItemEraseUserData,
  listItemFundDevelopment,
  listItemHomeAssistant,
  listItemInstallIcon,
  listItemVisitDevice,
  listItemWifi,
  refreshIcon,
} from "./components/svg";
import { Logger, Manifest, FlashStateType, FlashState } from "./const.js";
import { ImprovSerial, Ssid } from "improv-wifi-serial-sdk/dist/serial";
import {
  ImprovSerialCurrentState,
  ImprovSerialErrorState,
  PortNotReady,
} from "improv-wifi-serial-sdk/dist/const";
import { flash } from "./flash";
import { textDownload } from "./util/file-download";
import { fireEvent } from "./util/fire-event";
import { sleep } from "./util/sleep";
import { downloadManifest } from "./util/manifest";
import { dialogStyles } from "./styles";
import { version } from "./version";
import type { EwFilledSelect } from "./components/ew-filled-select";

console.log(
  `ESP Web Tools ${version} by Open Home Foundation; https://esphome.github.io/esp-web-tools/`,
);

const ERROR_ICON = "⚠️";
const OK_ICON = "🎉";

export class EwtInstallDialog extends LitElement {
  public port!: SerialPort;

  public manifestPath!: string;

  public logger: Logger = console;

  public overrides?: {
    checkSameFirmware?: (
      manifest: Manifest,
      deviceImprov: ImprovSerial["info"],
    ) => boolean;
  };

  private _manifest!: Manifest;

  private _info?: ImprovSerial["info"];

  // null = NOT_SUPPORTED
  @state() private _client?: ImprovSerial | null;

  @state() private _state:
    | "ERROR"
    | "DASHBOARD"
    | "PROVISION"
    | "INSTALL"
    | "ASK_ERASE"
    | "LOGS" = "DASHBOARD";

  @state() private _installErase = false;
  @state() private _installConfirmed = false;
  @state() private _installState?: FlashState;

  @state() private _provisionForce = false;
  private _wasProvisioned = false;

  @state() private _error?: string;

  @state() private _busy = false;

  // undefined = not loaded
  // null = not available
  @state() private _ssids?: Ssid[] | null;

  // Name of Ssid. Null = other
  @state() private _selectedSsid: string | null = null;

  private _bodyOverflow: string | null = null;

  protected render() {
    if (!this.port) {
      return html``;
    }
    let heading: string | undefined;
    let content: TemplateResult;
    let allowClosing = false;

    // During installation phase we temporarily remove the client
    if (
      this._client === undefined &&
      this._state !== "INSTALL" &&
      this._state !== "LOGS"
    ) {
      if (this._error) {
        [heading, content] = this._renderError(this._error);
      } else {
        content = this._renderProgress("Đang kết nối...");
      }
    } else if (this._state === "INSTALL") {
      [heading, content, allowClosing] = this._renderInstall();
    } else if (this._state === "ASK_ERASE") {
      [heading, content] = this._renderAskErase();
    } else if (this._state === "ERROR") {
      [heading, content] = this._renderError(this._error!);
    } else if (this._state === "DASHBOARD") {
      [heading, content, allowClosing] = this._client
        ? this._renderDashboard()
        : this._renderDashboardNoImprov();
    } else if (this._state === "PROVISION") {
      [heading, content] = this._renderProvision();
    } else if (this._state === "LOGS") {
      [heading, content] = this._renderLogs();
    }

    return html`
      <ew-dialog
        open
        .heading=${heading!}
        @cancel=${this._preventDefault}
        @closed=${this._handleClose}
      >
        ${heading
          ? html`<div slot="headline" style="display:flex;align-items:center;gap:8px;">
              <img src="/favicon-16x16.png" alt="HSL" width="20" height="20" style="flex-shrink:0;border-radius:4px;"/>
              ${heading}
            </div>`
          : ""}
        ${allowClosing
          ? html`
              <ew-icon-button slot="headline" @click=${this._closeDialog}>
                ${closeIcon}
              </ew-icon-button>
            `
          : ""}
        ${content!}
      </ew-dialog>
    `;
  }

  _renderProgress(label: string | TemplateResult, progress?: number) {
    return html`
      <ewt-page-progress
        slot="content"
        .label=${label}
        .progress=${progress}
      ></ewt-page-progress>
    `;
  }

  _renderError(label: string): [string, TemplateResult] {
    const heading = "Lỗi";
    const content = html`
      <ewt-page-message
        slot="content"
        .icon=${ERROR_ICON}
        .label=${label}
      ></ewt-page-message>
      <div slot="actions">
        <ew-text-button @click=${this._closeDialog}>Đóng</ew-text-button>
      </div>
    `;
    return [heading, content];
  }

  _renderDashboard(): [string, TemplateResult, boolean] {
    const heading = this._manifest.name;
    let content: TemplateResult;
    let allowClosing = true;

    content = html`
      <div slot="content">
        <ew-list>
          <ew-list-item>
            <div slot="headline">Đã kết nối: ${this._info!.name}</div>
            <div slot="supporting-text">
              ${this._info!.firmware}&nbsp;${this._info!.version}
              (${this._info!.chipFamily})
            </div>
          </ew-list-item>
          ${!this._isSameVersion
            ? html`
                <ew-list-item
                  type="button"
                  @click=${() => {
                    if (this._isSameFirmware) {
                      this._startInstall(false);
                    } else if (this._manifest.new_install_prompt_erase) {
                      this._state = "ASK_ERASE";
                    } else {
                      this._startInstall(true);
                    }
                  }}
                >
                  ${listItemInstallIcon}
                  <div slot="headline">
                    ${!this._isSameFirmware
                      ? `Cài đặt ${this._manifest.name}`
                      : `Cập nhật ${this._manifest.name}`}
                  </div>
                </ew-list-item>
              `
            : ""}
          ${this._client!.nextUrl === undefined
            ? ""
            : html`
                <ew-list-item
                  type="link"
                  href=${this._client!.nextUrl}
                  target="_blank"
                >
                  ${listItemVisitDevice}
                  <div slot="headline">Truy cập thiết bị</div>
                </ew-list-item>
              `}
          ${!this._manifest.home_assistant_domain ||
          this._client!.state !== ImprovSerialCurrentState.PROVISIONED
            ? ""
            : html`
                <ew-list-item
                  type="link"
                  href=${`https://my.home-assistant.io/redirect/config_flow_start/?domain=${this._manifest.home_assistant_domain}`}
                  target="_blank"
                >
                  ${listItemHomeAssistant}
                  <div slot="headline">Thêm vào Home Assistant</div>
                </ew-list-item>
              `}
          <ew-list-item
            type="button"
            @click=${() => {
              this._state = "PROVISION";
              if (
                this._client!.state === ImprovSerialCurrentState.PROVISIONED
              ) {
                this._provisionForce = true;
              }
            }}
          >
            ${listItemWifi}
            <div slot="headline">
              ${this._client!.state === ImprovSerialCurrentState.READY
                ? "Kết nối Wi-Fi"
                : "Đổi Wi-Fi"}
            </div>
          </ew-list-item>
          <ew-list-item
            type="button"
            @click=${async () => {
              const client = this._client;
              if (client) {
                await this._closeClientWithoutEvents(client);
                await sleep(100);
              }
              // Also set `null` back to undefined.
              this._client = undefined;
              this._state = "LOGS";
            }}
          >
            ${listItemConsole}
            <div slot="headline">Nhật ký & Bảng điều khiển</div>
          </ew-list-item>
          ${this._isSameFirmware && this._manifest.funding_url
            ? html`
                <ew-list-item
                  type="link"
                  href=${this._manifest.funding_url}
                  target="_blank"
                >
                  ${listItemFundDevelopment}
                  <div slot="headline">Hỗ trợ phát triển</div>
                </ew-list-item>
              `
            : ""}
          ${this._isSameVersion
            ? html`
                <ew-list-item
                  type="button"
                  class="danger"
                  @click=${() => this._startInstall(true)}
                >
                  ${listItemEraseUserData}
                  <div slot="headline">Xóa dữ liệu người dùng</div>
                </ew-list-item>
              `
            : ""}
        </ew-list>
      </div>
    `;

    return [heading, content, allowClosing];
  }
  _renderDashboardNoImprov(): [string, TemplateResult, boolean] {
    const heading = this._manifest.name;
    let content: TemplateResult;
    let allowClosing = true;

    content = html`
      <div slot="content">
        <ew-list>
          <ew-list-item
            type="button"
            @click=${() => {
              if (this._manifest.new_install_prompt_erase) {
                this._state = "ASK_ERASE";
              } else {
                // Default is to erase a device that does not support Improv Serial
                this._startInstall(true);
              }
            }}
          >
            ${listItemInstallIcon}
            <div slot="headline">${`Cài đặt ${this._manifest.name}`}</div>
          </ew-list-item>
          <ew-list-item
            type="button"
            @click=${async () => {
              // Also set `null` back to undefined.
              this._client = undefined;
              this._state = "LOGS";
            }}
          >
            ${listItemConsole}
            <div slot="headline">Nhật ký & Bảng điều khiển</div>
          </ew-list-item>
        </ew-list>
      </div>
    `;

    return [heading, content, allowClosing];
  }

  _renderProvision(): [string | undefined, TemplateResult] {
    let heading: string | undefined = "Cài đặt Wi-Fi";
    let content: TemplateResult;

    if (this._busy) {
      return [
        heading,
        this._renderProgress(
          this._ssids === undefined
            ? "Đang tìm mạng Wi-Fi..."
            : "Đang kết nối...",
        ),
      ];
    }

    if (
      !this._provisionForce &&
      this._client!.state === ImprovSerialCurrentState.PROVISIONED
    ) {
      heading = undefined;
      const showSetupLinks =
        !this._wasProvisioned &&
        (this._client!.nextUrl !== undefined ||
          "home_assistant_domain" in this._manifest);
      content = html`
        <div slot="content">
          <ewt-page-message
            .icon=${OK_ICON}
            label="Thiết bị đã kết nối mạng thành công!"
          ></ewt-page-message>
          ${showSetupLinks
            ? html`
                <ew-list>
                  ${this._client!.nextUrl === undefined
                    ? ""
                    : html`
                        <ew-list-item
                          type="link"
                          href=${this._client!.nextUrl}
                          target="_blank"
                          @click=${() => {
                            this._state = "DASHBOARD";
                          }}
                        >
                          ${listItemVisitDevice}
                          <div slot="headline">Truy cập thiết bị</div>
                        </ew-list-item>
                      `}
                  ${!this._manifest.home_assistant_domain
                    ? ""
                    : html`
                        <ew-list-item
                          type="link"
                          href=${`https://my.home-assistant.io/redirect/config_flow_start/?domain=${this._manifest.home_assistant_domain}`}
                          target="_blank"
                          @click=${() => {
                            this._state = "DASHBOARD";
                          }}
                        >
                          ${listItemHomeAssistant}
                          <div slot="headline">Thêm vào Home Assistant</div>
                        </ew-list-item>
                      `}
                  <ew-list-item
                    type="button"
                    @click=${() => {
                      this._state = "DASHBOARD";
                    }}
                  >
                    <div slot="start" class="fake-icon"></div>
                    <div slot="headline">Bỏ qua</div>
                  </ew-list-item>
                </ew-list>
              `
            : ""}
        </div>

        ${!showSetupLinks
          ? html`
              <div slot="actions">
                <ew-text-button
                  @click=${() => {
                    this._state = "DASHBOARD";
                  }}
                >
                  Tiếp tục
                </ew-text-button>
              </div>
            `
          : ""}
      `;
    } else {
      let error: string | undefined;

      switch (this._client!.error) {
        case ImprovSerialErrorState.UNABLE_TO_CONNECT:
          error = "Không thể kết nối";
          break;

        case ImprovSerialErrorState.TIMEOUT:
          error = "Hết thời gian chờ";
          break;

        case ImprovSerialErrorState.NO_ERROR:
        // Happens when list SSIDs not supported.
        case ImprovSerialErrorState.UNKNOWN_RPC_COMMAND:
          break;

        default:
          error = `Lỗi không xác định (${this._client!.error})`;
      }
      const selectedSsid = this._ssids?.find(
        (info) => info.name === this._selectedSsid,
      );
      content = html`
        <ew-icon-button slot="headline" @click=${this._updateSsids}>
          ${refreshIcon}
        </ew-icon-button>
        <div slot="content">
          <div>Kết nối thiết bị với mạng Wi-Fi để bắt đầu sử dụng.</div>
          ${error ? html`<p class="error">${error}</p>` : ""}
          ${this._ssids !== null
            ? html`
                <ew-filled-select
                  menu-positioning="fixed"
                  label="Tên mạng Wi-Fi"
                  @change=${(ev: { target: EwFilledSelect }) => {
                    const index = ev.target.selectedIndex;
                    // The "Join Other" item is always the last item.
                    this._selectedSsid =
                      index === this._ssids!.length
                        ? null
                        : this._ssids![index].name;
                  }}
                >
                  ${this._ssids!.map(
                    (info) => html`
                      <ew-select-option
                        .selected=${selectedSsid === info}
                        .value=${info.name}
                      >
                        ${info.name}
                      </ew-select-option>
                    `,
                  )}
                  <ew-divider></ew-divider>
                  <ew-select-option .selected=${!selectedSsid}>
                    Mạng khác…
                  </ew-select-option>
                </ew-filled-select>
              `
            : ""}
          ${
            // Show input box if command not supported or "Join Other" selected
            !selectedSsid
              ? html`
                  <ew-filled-text-field
                    label="Tên mạng"
                    name="ssid"
                  ></ew-filled-text-field>
                `
              : ""
          }
          ${!selectedSsid || selectedSsid.secured
            ? html`
                <ew-filled-text-field
                  label="Mật khẩu"
                  name="password"
                  type="password"
                ></ew-filled-text-field>
              `
            : ""}
        </div>
        <div slot="actions">
          <ew-text-button
            @click=${() => {
              this._state = "DASHBOARD";
            }}
          >
            ${this._installState && this._installErase ? "Bỏ qua" : "Quay lại"}
          </ew-text-button>
          <ew-text-button @click=${this._doProvision}>Kết nối</ew-text-button>
        </div>
      `;
    }
    return [heading, content];
  }

  _renderAskErase(): [string | undefined, TemplateResult] {
    const heading = "Xóa thiết bị";
    const content = html`
      <div slot="content">
        <div>
          Bạn có muốn xóa toàn bộ dữ liệu trước khi cài đặt
          ${this._manifest.name}? Tất cả dữ liệu trên thiết bị sẽ bị mất.
        </div>
        <label class="formfield">
          <ew-checkbox touch-target="wrapper" class="danger"></ew-checkbox>
          Xóa thiết bị
        </label>
      </div>
      <div slot="actions">
        <ew-text-button
          @click=${() => {
            this._state = "DASHBOARD";
          }}
        >
          Quay lại
        </ew-text-button>
        <ew-text-button
          @click=${() => {
            const checkbox = this.shadowRoot!.querySelector("ew-checkbox")!;
            this._startInstall(checkbox.checked);
          }}
        >
          Tiếp tục
        </ew-text-button>
      </div>
    `;

    return [heading, content];
  }

  _renderInstall(): [string | undefined, TemplateResult, boolean] {
    let heading: string | undefined;
    let content: TemplateResult;
    const allowClosing = false;

    const isUpdate = !this._installErase && this._isSameFirmware;

    if (!this._installConfirmed && this._isSameVersion) {
      heading = "Xóa dữ liệu người dùng";
      content = html`
        <div slot="content">
          Bạn có chắc muốn đặt lại thiết bị và xóa toàn bộ dữ liệu người dùng?
        </div>
        <div slot="actions">
          <ew-text-button class="danger" @click=${this._confirmInstall}>
            Xóa dữ liệu
          </ew-text-button>
        </div>
      `;
    } else if (!this._installConfirmed) {
      heading = "Xác nhận cài đặt";
      const action = isUpdate ? "cập nhật lên" : "cài đặt";
      content = html`
        <div slot="content">
          ${isUpdate
            ? html`Thiết bị đang chạy
                ${this._info!.firmware}&nbsp;${this._info!.version}.<br /><br />`
            : ""}
          Bạn có muốn ${action}
          ${this._manifest.name}&nbsp;${this._manifest.version}?
          ${this._installErase
            ? html`<br /><br />Toàn bộ dữ liệu trên thiết bị sẽ bị xóa.`
            : ""}
        </div>
        <div slot="actions">
          <ew-text-button
            @click=${() => {
              this._state = "DASHBOARD";
            }}
          >
            Quay lại
          </ew-text-button>
          <ew-text-button @click=${this._confirmInstall}>
            Cài đặt
          </ew-text-button>
        </div>
      `;
    } else if (
      !this._installState ||
      this._installState.state === FlashStateType.INITIALIZING ||
      this._installState.state === FlashStateType.PREPARING
    ) {
      heading = "Đang cài đặt";
      content = this._renderProgress("Đang chuẩn bị...");
    } else if (this._installState.state === FlashStateType.ERASING) {
      heading = "Đang cài đặt";
      content = this._renderProgress("Đang xóa flash...");
    } else if (
      this._installState.state === FlashStateType.WRITING ||
      // When we're finished, keep showing this screen with 100% written
      // until Improv is initialized / not detected.
      (this._installState.state === FlashStateType.FINISHED &&
        this._client === undefined)
    ) {
      heading = "Đang cài đặt";
      let percentage: number | undefined;
      let undeterminateLabel: string | undefined;
      if (this._installState.state === FlashStateType.FINISHED) {
        // We're done writing and detecting improv, show spinner
        undeterminateLabel = "Đang hoàn tất...";
      } else if (this._installState.details.percentage < 4) {
        // We're writing the firmware under 4%, show spinner or else we don't show any pixels
        undeterminateLabel = "Đang ghi firmware...";
      } else {
        // We're writing the firmware over 4%, show progress bar
        percentage = this._installState.details.percentage;
      }
      content = this._renderProgress(
        html`
          ${undeterminateLabel ? html`${undeterminateLabel}<br />` : ""}
          <br />
          Quá trình này mất khoảng
          ${this._installState.chipFamily === "ESP8266"
            ? "1 phút"
            : "2 phút"}.<br />
          Vui lòng giữ trang này mở để tránh bị chậm
        `,
        percentage,
      );
    } else if (this._installState.state === FlashStateType.FINISHED) {
      heading = undefined;
      const supportsImprov = this._client !== null;
      content = html`
        <ewt-page-message
          slot="content"
          .icon=${OK_ICON}
          label="Cài đặt hoàn tất!"
        ></ewt-page-message>

        <div slot="actions">
          <ew-text-button
            @click=${() => {
              this._state =
                supportsImprov && this._installErase
                  ? "PROVISION"
                  : "DASHBOARD";
            }}
          >
            Tiếp theo
          </ew-text-button>
        </div>
      `;
    } else if (this._installState.state === FlashStateType.ERROR) {
      heading = "Cài đặt thất bại";
      content = html`
        <ewt-page-message
          slot="content"
          .icon=${ERROR_ICON}
          .label=${this._installState.message}
        ></ewt-page-message>
        <div slot="actions">
          <ew-text-button
            @click=${async () => {
              this._initialize();
              this._state = "DASHBOARD";
            }}
          >
            Quay lại
          </ew-text-button>
        </div>
      `;
    }
    return [heading, content!, allowClosing];
  }

  _renderLogs(): [string | undefined, TemplateResult] {
    let heading: string | undefined = `Nhật ký`;
    let content: TemplateResult;

    content = html`
      <div slot="content">
        <ewt-console .port=${this.port} .logger=${this.logger}></ewt-console>
      </div>
      <div slot="actions">
        <ew-text-button
          @click=${async () => {
            await this.shadowRoot!.querySelector("ewt-console")!.reset();
          }}
        >
          Khởi động lại
        </ew-text-button>
        <ew-text-button
          @click=${() => {
            textDownload(
              this.shadowRoot!.querySelector("ewt-console")!.logs(),
              `esp-web-tools-logs.txt`,
            );

            this.shadowRoot!.querySelector("ewt-console")!.reset();
          }}
        >
          Tải nhật ký
        </ew-text-button>
        <ew-text-button
          @click=${async () => {
            await this.shadowRoot!.querySelector("ewt-console")!.disconnect();
            this._state = "DASHBOARD";
            this._initialize();
          }}
        >
          Quay lại
        </ew-text-button>
      </div>
    `;

    return [heading, content!];
  }

  public override willUpdate(changedProps: PropertyValues) {
    if (!changedProps.has("_state")) {
      return;
    }
    // Clear errors when changing between pages unless we change
    // to the error page.
    if (this._state !== "ERROR") {
      this._error = undefined;
    }
    // Scan for SSIDs on provision
    if (this._state === "PROVISION") {
      this._updateSsids();
    } else {
      // Reset this value if we leave provisioning.
      this._provisionForce = false;
    }

    if (this._state === "INSTALL") {
      this._installConfirmed = false;
      this._installState = undefined;
    }
  }

  private async _updateSsids(tries = 0) {
    const oldSsids = this._ssids;
    this._ssids = undefined;
    this._busy = true;

    let ssids: Ssid[];

    try {
      ssids = await this._client!.scan();
    } catch (err) {
      // When we fail while loading, pick "Join other"
      if (this._ssids === undefined) {
        this._ssids = null;
        this._selectedSsid = null;
      }
      this._busy = false;
      return;
    }

    // We will retry a few times if we don't get any results
    if (ssids.length === 0 && tries < 3) {
      console.log("SCHEDULE RETRY", tries);
      setTimeout(() => this._updateSsids(tries + 1), 2000);
      return;
    }

    if (oldSsids) {
      // If we had a previous list, ensure the selection is still valid
      if (
        this._selectedSsid &&
        !ssids.find((s) => s.name === this._selectedSsid)
      ) {
        this._selectedSsid = ssids[0].name;
      }
    } else {
      this._selectedSsid = ssids.length ? ssids[0].name : null;
    }

    this._ssids = ssids;
    this._busy = false;
  }

  protected override firstUpdated(changedProps: PropertyValues) {
    super.firstUpdated(changedProps);
    this._bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    this._initialize();
  }

  protected override updated(changedProps: PropertyValues) {
    super.updated(changedProps);

    if (changedProps.has("_state")) {
      this.setAttribute("state", this._state);
    }

    if (this._state !== "PROVISION") {
      return;
    }

    if (changedProps.has("_selectedSsid") && this._selectedSsid === null) {
      // If we pick "Join other", select SSID input.
      this._focusFormElement("ew-filled-text-field[name=ssid]");
    } else if (changedProps.has("_ssids")) {
      // Form is shown when SSIDs are loaded/marked not supported
      this._focusFormElement();
    }
  }

  private _focusFormElement(
    selector = "ew-filled-text-field, ew-filled-select",
  ) {
    const formEl = this.shadowRoot!.querySelector(
      selector,
    ) as LitElement | null;
    if (formEl) {
      formEl.updateComplete.then(() => setTimeout(() => formEl.focus(), 100));
    }
  }

  private async _initialize(justInstalled = false) {
    if (this.port.readable === null || this.port.writable === null) {
      this._state = "ERROR";
      this._error =
        "Cổng serial không thể đọc/ghi. Vui lòng đóng ứng dụng khác đang dùng cổng này và thử lại.";
      return;
    }

    try {
      this._manifest = await downloadManifest(this.manifestPath);
    } catch (err: any) {
      this._state = "ERROR";
      this._error = "Không tải được manifest firmware";
      return;
    }

    if (this._manifest.new_install_improv_wait_time === 0) {
      this._client = null;
      return;
    }

    const client = new ImprovSerial(this.port!, this.logger);
    client.addEventListener("state-changed", () => {
      this.requestUpdate();
    });
    client.addEventListener("error-changed", () => this.requestUpdate());
    try {
      // If a device was just installed, give new firmware 10 seconds (overridable) to
      // format the rest of the flash and do other stuff.
      const timeout = !justInstalled
        ? 1000
        : this._manifest.new_install_improv_wait_time !== undefined
          ? this._manifest.new_install_improv_wait_time * 1000
          : 10000;
      this._info = await client.initialize(timeout);
      this._client = client;
      client.addEventListener("disconnect", this._handleDisconnect);
    } catch (err: any) {
      // Clear old value
      this._info = undefined;
      if (err instanceof PortNotReady) {
        this._state = "ERROR";
        this._error =
          "Cổng serial chưa sẵn sàng. Vui lòng đóng ứng dụng khác đang dùng cổng này và thử lại.";
      } else {
        this._client = null; // not supported
        this.logger.error("Improv initialization failed.", err);
      }
    }
  }

  private _startInstall(erase: boolean) {
    this._state = "INSTALL";
    this._installErase = erase;
    this._installConfirmed = false;
  }

  private async _confirmInstall() {
    this._installConfirmed = true;
    this._installState = undefined;
    if (this._client) {
      await this._closeClientWithoutEvents(this._client);
    }
    this._client = undefined;

    // Close port. ESPLoader likes opening it.
    await this.port.close();
    flash(
      (state) => {
        this._installState = state;

        if (state.state === FlashStateType.FINISHED) {
          sleep(100)
            // Flashing closes the port
            .then(() => this.port.open({ baudRate: 115200, bufferSize: 8192 }))
            .then(() => this._initialize(true))
            .then(() => this.requestUpdate());
        } else if (state.state === FlashStateType.ERROR) {
          sleep(100)
            // Flashing closes the port
            .then(() => this.port.open({ baudRate: 115200, bufferSize: 8192 }));
        }
      },
      this.port,
      this.manifestPath,
      this._manifest,
      this._installErase,
    );
  }

  private async _doProvision() {
    this._busy = true;
    this._wasProvisioned =
      this._client!.state === ImprovSerialCurrentState.PROVISIONED;
    const ssid =
      this._selectedSsid === null
        ? (
            this.shadowRoot!.querySelector(
              "ew-filled-text-field[name=ssid]",
            ) as EwFilledTextField
          ).value
        : this._selectedSsid;
    const password =
      (
        this.shadowRoot!.querySelector(
          "ew-filled-text-field[name=password]",
        ) as EwFilledTextField | null
      )?.value || "";
    try {
      await this._client!.provision(ssid, password, 30000);
    } catch (err: any) {
      return;
    } finally {
      this._busy = false;
      this._provisionForce = false;
    }
  }

  private _handleDisconnect = () => {
    this._state = "ERROR";
    this._error = "Đã mất kết nối với thiết bị";
  };

  private _closeDialog() {
    this.shadowRoot!.querySelector("ew-dialog")!.close();
  }

  private async _handleClose() {
    if (this._client) {
      await this._closeClientWithoutEvents(this._client);
    }
    fireEvent(this, "closed" as any);
    document.body.style.overflow = this._bodyOverflow!;
    this.parentNode!.removeChild(this);
  }

  /**
   * Return if the device runs same firmware as manifest.
   */
  private get _isSameFirmware() {
    return !this._info
      ? false
      : this.overrides?.checkSameFirmware
        ? this.overrides.checkSameFirmware(this._manifest, this._info)
        : this._info.firmware === this._manifest.name;
  }

  /**
   * Return if the device runs same firmware and version as manifest.
   */
  private get _isSameVersion() {
    return (
      this._isSameFirmware && this._info!.version === this._manifest.version
    );
  }

  private async _closeClientWithoutEvents(client: ImprovSerial) {
    client.removeEventListener("disconnect", this._handleDisconnect);
    await client.close();
  }

  private _preventDefault(ev: Event) {
    ev.preventDefault();
  }

  static styles = [
    dialogStyles,
    css`
      :host {
        --mdc-dialog-max-width: 390px;
      }
      div[slot="headline"] {
        padding-right: 48px;
      }
      ew-icon-button[slot="headline"] {
        position: absolute;
        right: 4px;
        top: 8px;
      }
      ew-icon-button[slot="headline"] svg {
        padding: 8px;
        color: var(--text-color);
      }
      .dialog-nav svg {
        color: var(--text-color);
      }
      .table-row {
        display: flex;
      }
      .table-row.last {
        margin-bottom: 16px;
      }
      .table-row svg {
        width: 20px;
        margin-right: 8px;
      }
      ew-filled-text-field,
      ew-filled-select {
        display: block;
        margin-top: 16px;
      }
      label.formfield {
        display: inline-flex;
        align-items: center;
        padding-right: 8px;
      }
      ew-list {
        margin: 0 -24px;
        padding: 0;
      }
      ew-list-item svg {
        height: 24px;
      }
      ewt-page-message + ew-list {
        padding-top: 16px;
      }
      .fake-icon {
        width: 24px;
      }
      .error {
        color: var(--danger-color);
      }
      .danger {
        --mdc-theme-primary: var(--danger-color);
        --mdc-theme-secondary: var(--danger-color);
        --md-sys-color-primary: var(--danger-color);
        --md-sys-color-on-surface: var(--danger-color);
      }
      button.link {
        background: none;
        color: inherit;
        border: none;
        padding: 0;
        font: inherit;
        text-align: left;
        text-decoration: underline;
        cursor: pointer;
      }
      :host([state="LOGS"]) ew-dialog {
        max-width: 90vw;
        max-height: 90vh;
      }
      ewt-console {
        width: calc(80vw - 48px);
        height: calc(90vh - 168px);
      }
    `,
  ];
}

customElements.define("ewt-install-dialog", EwtInstallDialog);

declare global {
  interface HTMLElementTagNameMap {
    "ewt-install-dialog": EwtInstallDialog;
  }
}
