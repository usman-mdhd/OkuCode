import { createResource, lazy, Show, Suspense } from "solid-js"
import { googleEnabled, googleSignInUrl, signInError } from "@/okutobus/account"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { Wordmark } from "@opencode/ui/wordmark"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useCheckServerHealth } from "@/runtime/server/health"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { bareServerAddress, serverAddress, type Pairing } from "./pairing"
import { useRedeemPairing } from "./redeem"
import { isMixedContent } from "./browser"
import { cameraHint, createCameraAvailability } from "./camera"
import { ConnectMethodSwitch, type ConnectMethod } from "./method"
import "./screen.css"

// Okutobus (OkuCode): "Continue with Google" for team members, shown when the server has Google sign-in set up.
function GoogleSignIn(props: { url?: string }) {
  const [enabled] = createResource(
    () => props.url,
    (url) => googleEnabled(url),
  )
  const error = signInError(location.search)
  return (
    <>
      <Show when={error}>
        <p class="server-connect-error" role="alert">
          {error}
        </p>
      </Show>
      <Show when={enabled() && props.url}>
        {(url) => (
          <div data-slot="okucode-google" style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
            <a
              href={googleSignInUrl(url())}
              rel="external"
              onClick={(event) => {
                // A full page load: the app's router must not handle this link.
                event.preventDefault()
                window.location.assign(googleSignInUrl(url()))
              }}
              style={{
                display: "flex",
                "align-items": "center",
                "justify-content": "center",
                gap: "10px",
                padding: "11px 16px",
                "border-radius": "10px",
                border: "1px solid var(--v2-border-border-muted, #d0d7de)",
                color: "inherit",
                "text-decoration": "none",
                "font-weight": "500",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
                <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
                <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
              </svg>
              Continue with Google
            </a>
            <p style={{ "text-align": "center", margin: "0", opacity: "0.6", "font-size": "12px" }}>or connect with a password</p>
          </div>
        )}
      </Show>
    </>
  )
}

const PairingScanner = lazy(() => import("./scanner").then((module) => ({ default: module.PairingScanner })))

export function ConnectServerScreen(props: { url?: string } = {}) {
  const language = useLanguage()
  const platform = usePlatform()
  const servers = useServers()
  const check = useCheckServerHealth()
  const redeem = useRedeemPairing()
  const camera = createCameraAvailability()

  const [state, setState] = createStore<{
    method: ConnectMethod
    link: string
    url: string
    password: string
    error: string
    scanning: boolean
  }>({
    method: "link",
    link: "",
    url: props.url ?? "",
    password: "",
    error: "",
    scanning: false,
  })

  // A pairing token works on every address of its server. Signing in again to the server that signed out keeps its
  // address (e.g. localhost) even when the link names another one (e.g. 127.0.0.1 from opencode pair).
  const target = async (pairing: Pairing) => {
    if (!props.url || props.url === pairing.url) return pairing
    const http = { url: props.url, password: pairing.password }

    return (await check(http)).healthy ? http : pairing
  }

  const connect = async (http: ServerConnection.HttpBase) => {
    const result = await check(http)

    if (!result.healthy) {
      setState("error", connectionError(http.url))

      return
    }

    // Signing in again keeps the name the user gave this server.
    const existing = servers.list.find(
      (server): server is ServerConnection.Http => server.type === "http" && server.http.url === http.url,
    )

    servers.add(existing ? { ...existing, http } : { type: "http", http })
  }

  const connectionError = (url: string) =>
    language.t(
      platform.platform === "web" && isMixedContent(location.href, url)
        ? "server.connect.mixedContent"
        : "server.connect.failed",
    )

  const request = useMutation(() => ({
    mutationFn: async () => {
      if (state.method === "link") {
        const redeemed = await redeem(state.link)

        if (redeemed && "error" in redeemed) return void setState("error", redeemed.error)

        if (redeemed) return connect(await target(redeemed.pairing))
        // A server address typed here belongs to the password form.
        const address = bareServerAddress(state.link)

        if (address) return void setState({ method: "password", url: address, link: "", error: "" })

        return void setState("error", language.t("server.connect.link.invalid"))
      }

      // A pairing link pasted into the address field still pairs.
      const redeemed = await redeem(state.url)

      if (redeemed && "error" in redeemed) return void setState("error", redeemed.error)

      if (redeemed) return connect(await target(redeemed.pairing))
      const url = serverAddress(state.url)

      if (!url) return void setState("error", language.t("server.connect.address.invalid"))

      await connect({ url, password: state.password || undefined })
    },
    onError: () => setState("error", connectionError(state.method === "link" ? state.link : state.url)),
  }))

  const submit = () => {
    if (request.isPending) return
    setState("error", "")
    request.mutate()
  }

  return (
    <main data-component="connect-server" aria-labelledby="server-connect-title">
      <div class="server-connect-content">
        <div class="server-connect-brand" role="img" aria-label="OpenCode">
          <Wordmark />
        </div>
        <header>
          <h1 id="server-connect-title">{language.t("server.connect.title")}</h1>
          <p>
            {language.t(state.method === "link" ? "server.connect.description.pairing" : "server.connect.description")}
          </p>
        </header>
        <GoogleSignIn url={props.url ?? (platform.platform === "web" ? location.origin : undefined)} />
        <Show
          when={!state.scanning}
          fallback={
            <Suspense fallback={<p role="status">{language.t("server.connect.camera.starting")}</p>}>
              <PairingScanner
                redeem={redeem}
                onCancel={() => {
                  setState("scanning", false)
                  void camera.refetch()
                }}
                onScan={(link) => {
                  setState({ method: "link", link, error: "", scanning: false })
                  request.mutate()
                }}
              />
            </Suspense>
          }
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <Show
              when={state.method === "password"}
              fallback={
                <div class="server-connect-field">
                  <label for="server-connect-link">{language.t("server.connect.link")}</label>
                  <TextInput
                    id="server-connect-link"
                    name="link"
                    dir="ltr"
                    type="text"
                    inputMode="url"
                    autocapitalize="off"
                    spellcheck={false}
                    required
                    appearance="large"
                    placeholder={language.t("server.connect.link.placeholder")}
                    value={state.link}
                    disabled={request.isPending}
                    aria-describedby={state.error ? "server-connect-error" : undefined}
                    onInput={(event) => setState({ link: event.currentTarget.value, error: "" })}
                  />
                </div>
              }
            >
              <div class="server-connect-field">
                <label for="server-connect-url">{language.t("dialog.server.add.url")}</label>
                <TextInput
                  id="server-connect-url"
                  name="server"
                  dir="ltr"
                  type="text"
                  inputMode="url"
                  autocomplete="url"
                  autocapitalize="off"
                  spellcheck={false}
                  required
                  appearance="large"
                  placeholder={language.t("dialog.server.add.placeholder")}
                  value={state.url}
                  disabled={request.isPending}
                  aria-describedby={state.error ? "server-connect-error" : undefined}
                  onInput={(event) => setState({ url: event.currentTarget.value, error: "" })}
                />
              </div>
              <div class="server-connect-field">
                <label for="server-connect-password">{language.t("dialog.server.add.password")}</label>
                <TextInput
                  id="server-connect-password"
                  name="password"
                  type="password"
                  autocomplete="current-password"
                  appearance="large"
                  value={state.password}
                  disabled={request.isPending}
                  aria-describedby="server-connect-password-hint"
                  onInput={(event) => setState({ password: event.currentTarget.value, error: "" })}
                />
                <p id="server-connect-password-hint" class="server-connect-hint">
                  {language.t("server.connect.password.hint")}
                </p>
              </div>
            </Show>
            <Show when={state.error}>
              <p id="server-connect-error" class="server-connect-error" role="alert">
                {state.error}
              </p>
            </Show>
            <Button
              type="submit"
              variant="contrast"
              size="large"
              disabled={request.isPending || !(state.method === "link" ? state.link : state.url).trim()}
            >
              {language.t(request.isPending ? "dialog.server.add.checking" : "server.connect.button")}
            </Button>
          </form>
          <Show when={state.method === "link" && platform.platform === "web"}>
            <Show
              when={camera.available.latest || camera.available.loading}
              fallback={<p>{language.t(cameraHint())}</p>}
            >
              <Button
                variant="neutral"
                size="large"
                disabled={request.isPending || !camera.available.latest}
                onClick={() => setState("scanning", true)}
              >
                {language.t("server.connect.scan")}
              </Button>
            </Show>
          </Show>
          <ConnectMethodSwitch
            method={state.method}
            disabled={request.isPending}
            onChange={(method) => setState({ method, error: "" })}
          />
          <Show when={state.method === "link"}>
            <footer>
              <p>{language.t("server.connect.pair.link")}</p>
              <code dir="ltr">okucode pair</code>
            </footer>
          </Show>
        </Show>
      </div>
    </main>
  )
}
