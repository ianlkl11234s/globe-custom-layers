FROM node:22-alpine AS build

WORKDIR /app

# Install each self-contained package before copying its source so dependency
# layers remain cacheable. The site build intentionally imports the selected
# example source without making the examples share a package.
COPY site/package.json site/package-lock.json ./site/
COPY examples/00-native-vs-custom/package.json examples/00-native-vs-custom/package-lock.json ./examples/00-native-vs-custom/
COPY examples/01-points-on-globe/package.json examples/01-points-on-globe/package-lock.json ./examples/01-points-on-globe/
COPY examples/02-arcs-on-globe/package.json examples/02-arcs-on-globe/package-lock.json ./examples/02-arcs-on-globe/
COPY examples/05-mass-trajectories/package.json examples/05-mass-trajectories/package-lock.json ./examples/05-mass-trajectories/

RUN npm ci --prefix site \
  && npm ci --prefix examples/00-native-vs-custom \
  && npm ci --prefix examples/01-points-on-globe \
  && npm ci --prefix examples/02-arcs-on-globe \
  && npm ci --prefix examples/05-mass-trajectories

# Explicit allowlist: neither local .env files nor unrelated cookbook examples
# enter the build context image.
COPY site/index.html site/styles.css site/app.js site/i18n.js site/bridgeState.js ./site/
COPY site/freeGlobe.js site/mapboxMathCompat.ts site/maplibreCustom.ts ./site/
COPY site/land.json site/airports.json ./site/
COPY site/scripts/build.mjs ./site/scripts/build.mjs
COPY examples/00-native-vs-custom/index.html examples/00-native-vs-custom/tsconfig.json examples/00-native-vs-custom/vite.config.ts ./examples/00-native-vs-custom/
COPY examples/00-native-vs-custom/public ./examples/00-native-vs-custom/public
COPY examples/00-native-vs-custom/screenshots ./examples/00-native-vs-custom/screenshots
COPY examples/00-native-vs-custom/src ./examples/00-native-vs-custom/src
COPY examples/01-points-on-globe/index.html examples/01-points-on-globe/tsconfig.json examples/01-points-on-globe/vite.config.ts ./examples/01-points-on-globe/
COPY examples/01-points-on-globe/public ./examples/01-points-on-globe/public
COPY examples/01-points-on-globe/screenshots ./examples/01-points-on-globe/screenshots
COPY examples/01-points-on-globe/src ./examples/01-points-on-globe/src
COPY examples/02-arcs-on-globe/index.html examples/02-arcs-on-globe/tsconfig.json examples/02-arcs-on-globe/vite.config.ts ./examples/02-arcs-on-globe/
COPY examples/02-arcs-on-globe/public ./examples/02-arcs-on-globe/public
COPY examples/02-arcs-on-globe/screenshots ./examples/02-arcs-on-globe/screenshots
COPY examples/02-arcs-on-globe/src ./examples/02-arcs-on-globe/src
COPY examples/05-mass-trajectories/index.html examples/05-mass-trajectories/tsconfig.json examples/05-mass-trajectories/vite.config.ts ./examples/05-mass-trajectories/
COPY examples/05-mass-trajectories/screenshots ./examples/05-mass-trajectories/screenshots
COPY examples/05-mass-trajectories/src ./examples/05-mass-trajectories/src

RUN npm run build --prefix site

FROM nginx:1.27-alpine

COPY site/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/site/dist /usr/share/nginx/html

EXPOSE 8080
