.DEFAULT_GOAL := check

.PHONY: install dev check lint test test-web build generate fix docker-build docker-run docker-check

install:
	mise run install

dev:
	mise run dev

check:
	mise run check

lint:
	mise run lint

test:
	mise run test

test-web:
	mise run test:web

build:
	mise run build

generate:
	mise run generate

fix:
	mise run fix

docker-build:
	mise run docker:build

docker-run:
	mise run docker:run

docker-check:
	mise run docker:check
