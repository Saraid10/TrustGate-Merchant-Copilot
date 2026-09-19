# One image that carries the whole demo: the API, the merchant UI, and the simulated payment rail.
# A judge opening the link should get a working product, not a service that needs a second service
# to be up before the first one means anything.
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /srv

# Installed editable, and from the whole tree rather than a requirements file, for two reasons:
# `api/app.py` resolves `web/dist` relative to the source, and the dependency list stays stated in
# exactly one place. Nothing here uses a build feature that needs a particular BuildKit frontend,
# because a deployment that only builds on one builder is not a deployment.
COPY . .
RUN pip install -e . && chmod +x deploy/entrypoint.sh

EXPOSE 8000
CMD ["./deploy/entrypoint.sh"]
