import { createUniqueId, type ComponentProps } from "solid-js"

// Okutobus: OkuCode wordmark ("okucode"), drawn in the upstream letter style.
export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const mask = createUniqueId()
  const maskGradient = createUniqueId()

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 628 129"
      fill="none"
      classList={{
        [props.class ?? ""]: !!props.class,
        "overflow-visible [&_path]:[vector-effect:non-scaling-stroke]": props.outline,
      }}
    >
      <g opacity={props.muted === false ? 1 : 0.6} class="[[data-color-scheme=dark]_&]:opacity-100">
        <g mask={props.fade === false ? undefined : `url(#${mask})`}>
          <g
            opacity={props.muted === false ? 1 : 0.16 * 0.7}
            fill={props.outline ? "none" : "currentColor"}
            stroke={props.outline ? "currentColor" : undefined}
            stroke-width={props.outline ? 1 : undefined}
          >
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M55.3846 36.4286H18.4615V91.7143H55.3846V36.4286ZM73.8462 110.143H0V18H73.8462V110.143Z"
            />
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M92 0H110.462V110.143H92V0ZM110.462 54.8571H147.385V73.2857H110.462V54.8571ZM147.385 18H165.846V54.8571H147.385V18ZM147.385 73.2857H165.846V110.143H147.385V73.2857Z"
            />
            <path
              pathLength={props.outline ? 1 : undefined}
              d="M185 18H203.462V110.143H185V18ZM203.462 91.7143H240.385V110.143H203.462V91.7143ZM240.385 18H258.846V110.143H240.385V18Z"
            />
            <g transform="translate(-92 0)">
              <path
                pathLength={props.outline ? 1 : undefined}
                d="M442.846 36.4286H387.462V91.7143H442.846V110.143H369V18H442.846V36.4286Z"
              />
              <path
                pathLength={props.outline ? 1 : undefined}
                d="M517.385 36.4286H480.462V91.7143H517.385V36.4286ZM535.846 110.143H462V18H535.846V110.143Z"
              />
              <path
                pathLength={props.outline ? 1 : undefined}
                d="M609.385 36.8571H572.462V92.1429H609.385V36.8571ZM627.846 110.571H554V18.4286H609.385V0H627.846V110.571Z"
              />
              <path
                pathLength={props.outline ? 1 : undefined}
                d="M664.462 36.4286V54.8571H701.385V36.4286H664.462ZM719.846 73.2857H664.462V91.7143H719.846V110.143H646V18H719.846V73.2857Z"
              />
            </g>
          </g>
        </g>
      </g>
      <defs>
        <mask id={mask} style="mask-type:alpha" maskUnits="userSpaceOnUse" x="0" y="0" width="628" height="129">
          <rect width="628" height="129" fill={`url(#${maskGradient})`} />
        </mask>
        <linearGradient id={maskGradient} x1="314" y1="68" x2="314" y2="129" gradientUnits="userSpaceOnUse">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
      </defs>
    </svg>
  )
}
