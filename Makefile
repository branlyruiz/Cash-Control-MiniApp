PYTHON ?= python3
BACKEND := cash-control--backend
FRONTEND := cash-control-admin--front
FRONTEND_PORT ?= 3100

.PHONY: help setup dev backend frontend build import-september

help:
	@echo "make dev                    Instala lo necesario y abre ambos servidores"
	@echo "make dev FRONTEND_PORT=3200  Usa otro puerto si 3100 está ocupado"
	@echo "make backend                Inicia solo la API (puerto 8000)"
	@echo "make frontend               Inicia solo la web (puerto 3100)"
	@echo "make build                  Comprueba la compilación del frontend"
	@echo "make import-september       Importa septiembre al único usuario de la app"
	@echo "make setup PYTHON=python3.12  Elige Python si python3 es anterior a 3.10"

setup: $(BACKEND)/.venv/.deps-installed $(FRONTEND)/node_modules/.package-lock.json $(FRONTEND)/.env.local

$(BACKEND)/.venv/.deps-installed: $(BACKEND)/requirements.txt
	@$(PYTHON) -c 'import sys; assert sys.version_info >= (3, 10), "Se requiere Python 3.10+. Usa make setup PYTHON=python3.12"'
	$(PYTHON) -m venv $(BACKEND)/.venv
	$(BACKEND)/.venv/bin/python -m pip install -r $(BACKEND)/requirements.txt
	touch $(BACKEND)/.venv/.deps-installed

$(FRONTEND)/node_modules/.package-lock.json: $(FRONTEND)/package-lock.json
	cd $(FRONTEND) && npm ci

$(FRONTEND)/.env.local: $(FRONTEND)/.env.example
	cp $(FRONTEND)/.env.example $(FRONTEND)/.env.local

dev: setup
	FRONTEND_PORT=$(FRONTEND_PORT) bash scripts/dev.sh

backend: $(BACKEND)/.venv/.deps-installed
	cd $(BACKEND) && .venv/bin/uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

frontend: $(FRONTEND)/node_modules/.package-lock.json $(FRONTEND)/.env.local
	cd $(FRONTEND) && ./node_modules/.bin/next dev --hostname 127.0.0.1 --port $(FRONTEND_PORT)

build: setup
	cd $(FRONTEND) && npm run build

import-september: $(BACKEND)/.venv/.deps-installed
	cd $(BACKEND) && .venv/bin/python -m app.import_september
