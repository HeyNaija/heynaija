# The upstream release remains responsible for OAuth verification and sessions.
# Account linking and email changes are patched; see policy/README.md.
FROM golang:1.26-trixie AS build
RUN apt-get update && apt-get install -y --no-install-recommends patch && rm -rf /var/lib/apt/lists/*
WORKDIR /src
ARG KRATOS_VERSION=v26.2.0
RUN curl -fsSL "https://codeload.github.com/ory/kratos/tar.gz/refs/tags/${KRATOS_VERSION}" -o /tmp/kratos.tar.gz \
 && echo '68fb4098bc974cd97473b66a5f2bbf5b7e3269d365fd0500c7f54fe14b7ee095  /tmp/kratos.tar.gz' | sha256sum -c - \
 && tar -xzf /tmp/kratos.tar.gz --strip-components=1 -C /src && rm /tmp/kratos.tar.gz
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY policy /policy
RUN patch --batch --fuzz=0 -p1 < /policy/google-account-linking.patch \
 && patch --batch --fuzz=0 -p1 < /policy/email-confirmation.patch \
 && cp /policy/heynaija*.go selfservice/strategy/oidc/ \
 && cp /policy/profile_email*.go selfservice/strategy/profile/ \
 && cp /policy/persistence_email.go persistence/sql/ \
 && cp /policy/courier_email_change.go courier/template/email/heynaija_email_change.go \
 && cp /policy/courier_email_change_test.go courier/template/email/heynaija_email_change_test.go \
 && gofmt -w selfservice/strategy/oidc/heynaija*.go selfservice/strategy/oidc/strategy.go selfservice/strategy/oidc/strategy_login.go selfservice/strategy/oidc/strategy_registration.go selfservice/strategy/oidc/strategy_settings.go selfservice/strategy/profile/profile_email*.go selfservice/strategy/profile/strategy.go persistence/sql/persistence_email.go courier/template/email/heynaija_email_change*.go
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
 CGO_ENABLED=0 go test ./selfservice/strategy/oidc ./selfservice/strategy/profile ./courier/template/email -run '^TestHeyNaija' -count=1
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
 CGO_ENABLED=0 go build -ldflags="-X github.com/ory/kratos/driver/config.Version=v26.2.0-heynaija.4" -o /out/kratos .

FROM oryd/kratos:v26.2.0 AS kratos
COPY --from=build /out/kratos /usr/bin/kratos
