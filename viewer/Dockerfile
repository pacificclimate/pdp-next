FROM nginx:alpine

COPY viewer/nginx.conf /etc/nginx/conf.d/default.conf
COPY viewer/favicon.ico /usr/share/nginx/html/
RUN chmod 644 /usr/share/nginx/html/favicon.ico
COPY viewer/pdp-next-viewer.html /usr/share/nginx/html/
COPY viewer/viewer.css /usr/share/nginx/html/
COPY viewer/js /usr/share/nginx/html/js
COPY viewer/styles /usr/share/nginx/html/styles