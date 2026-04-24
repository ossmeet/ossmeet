ARG CADDY_VERSION=v2.11.2
ARG L4_MODULE_VERSION=v0.1.0
ARG XCADDY_VERSION=v0.4.5

FROM golang:1.25-alpine AS builder

ARG CADDY_VERSION
ARG L4_MODULE_VERSION
ARG XCADDY_VERSION

RUN apk add --no-cache git ca-certificates

RUN go install github.com/caddyserver/xcaddy/cmd/xcaddy@${XCADDY_VERSION}

ENV CGO_ENABLED=0

RUN xcaddy build ${CADDY_VERSION} \
    --output /usr/bin/caddy \
    --with github.com/mholt/caddy-l4@${L4_MODULE_VERSION}

RUN /usr/bin/caddy version
RUN /usr/bin/caddy list-modules | grep layer4

FROM alpine:3.21

RUN apk add --no-cache ca-certificates libcap tzdata && \
    addgroup -S caddy && \
    adduser -S caddy -G caddy && \
    mkdir -p /data /config && \
    chown -R caddy:caddy /data /config

COPY --from=builder /usr/bin/caddy /usr/bin/caddy

RUN setcap cap_net_bind_service=+ep /usr/bin/caddy

EXPOSE 80 443 443/udp 2019

USER caddy

ENTRYPOINT ["caddy"]
CMD ["run", "--config", "/etc/caddy.json"]
