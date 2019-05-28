SHELL := /bin/bash

ENV ?= dev
DC := docker-compose -f docker/docker-compose.yml --project-name codycolor
DC_RUN := ${DC} run --rm

include config.env
export

.PHONY: confirmation
confirmation:
	@echo -n 'Are you sure? [y|N] ' && read ans && [ $$ans == y ]

.PHONY: cmd
cmd:
	@echo 'Docker-Compose command for ${ENV} environment:'
	@echo '${DC}'

.PHONY: up
up:
	${DC} up -d
	${DC} ps
	@echo
	@echo 'CodyColor service is now up'
	@echo

.PHONY: ps
ps:
	${DC} ps

.PHONY: rs
rs:
	${DC} restart

.PHONY: rebuild
rebuild:
	${DC} rm -sf server
	${DC} build server
	${DC} up -d

.PHONY: stop
stop:
	${DC} stop

.PHONY: rm
rm:
	${DC} rm -fs
