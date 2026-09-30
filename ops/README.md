# Operations

Host-level integration. Nothing here runs inside the container.

## Starting a workspace on boot

Docker's `--restart on-failure:5` survives a **daemon** restart, not a **host**
reboot — after a reboot the container is simply gone until something starts it
again. `cod-workspace@.service` is that something.

```sh
# once, to install
install -m 644 ops/cod-workspace@.service /etc/systemd/system/

# per workspace
sudo systemctl enable --now cod-workspace@acme.service
```

The unit is templated on the workspace name, so several run independently. It
calls `cod up`, which is idempotent — enabling it for a workspace that is
already running is a no-op.

`cod` must be on the host's `PATH` at `/usr/local/bin/cod` (adjust `ExecStart`
if yours is elsewhere). Point it at the built entry point:

```sh
sudo ln -sf /path/to/corporate-on-demand/src/index.ts /usr/local/bin/cod
```

## Cleanup

`cod down` deliberately **keeps** the work volume, so an agent's committed work
survives a restart. Volumes therefore accumulate. When you actually want the
work gone:

```sh
cod purge            # refuses, and says why
cod purge --purge    # removes the volume and every commit in it
```

`purge` is irreversible. The volume name is derived from the workspace path,
never accepted from the caller, so it cannot be pointed at another volume.
