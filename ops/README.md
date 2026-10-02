# Operations

Host-level integration. Nothing here runs inside the container.

## Starting a workspace on boot

Docker's `--restart on-failure:5` survives a **daemon** restart, not a **host**
reboot — after a reboot the container is simply gone until something starts it
again. `cod-workspace@.service` is that something.

```sh
# once, to install
sudo install -m 644 ops/cod-workspace@.service /etc/systemd/system/

# per workspace: the workspace file and its own state dir, where the unit looks
sudo install -d -o 1000 -g 1000 -m 0750 /var/lib/cod/acme
sudo cod init acme --yes --workspace /var/lib/cod/acme/cod.json --state /var/lib/cod/acme
sudo chown -R 1000:1000 /var/lib/cod/acme   # what init wrote, for the container's uid
sudo systemctl enable --now cod-workspace@acme.service
```

The unit is templated on the workspace name, so several run independently, each
with its own state directory - a state directory belongs to exactly one
workspace, and `cod up` refuses a second. It calls `cod up`, which is idempotent:
enabling it for a running workspace is a no-op, and a container that exists but
stopped (after a reboot, or after the restart policy gave up) is replaced.

The state directory must belong to uid 1000, the uid the container runs as; a
root-owned one leaves the supervisor unable to write its heartbeat, and `cod up`
then fails waiting for a live schedule. The same goes for anything a root `cod`
creates in it - run host-side `cod work ...` commands as uid 1000, or `chown`
again afterwards.

`cod` must be on the host's `PATH` at `/usr/local/bin/cod` (adjust `ExecStart`
if yours is elsewhere), and so must `bun`, because `cod` is a
`#!/usr/bin/env bun` script:

```sh
sudo ln -sf /path/to/corporate-on-demand/src/index.ts /usr/local/bin/cod
sudo ln -sf "$(command -v bun)" /usr/local/bin/bun
```

## Exporting landed work

Reviewed work is merged inside the work volume and written to the state
directory as a bundle. Nothing on the host is writable from the container, so
exporting it is a host-side step:

```sh
cod land                       # fetch it into landing.repo as cod-landed
git -C /path/to/repo push origin cod-landed   # publishing it is yours
```

`cod status` says when there is landed work that has not been exported. A
systemd timer or a cron entry can run `cod land` if it should happen on its own.

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
