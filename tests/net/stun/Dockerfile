# STUN and TURN for the lab (coturn), on the lab's "internet", so the lab routers' NAT decides what connects.
FROM alpine:3.20
RUN apk add --no-cache coturn
ENTRYPOINT ["turnserver", "-n", "--listening-port=3478", "--fingerprint", "--lt-cred-mech", "--user=lab:lab", "--realm=lab", "--no-tls", "--no-dtls", "--no-cli", "--log-file=stdout", "--allow-loopback-peers", "--cli-password=x"]
