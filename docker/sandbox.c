/*
 * cod-sandbox: run one program inside a Landlock filesystem sandbox.
 *
 *   cod-sandbox [--ro PATH]... [--rw PATH]... -- PROGRAM [ARG]...
 *   cod-sandbox --probe
 *
 * Every agent the supervisor starts goes through this. Before it existed the
 * only thing between an agent with a shell and the work ledger, the base branch
 * and every other agent's worktree was a sentence in AGENTS.md - and the
 * security posture said, correctly, that a sentence is not a control (SEC-03).
 *
 * Landlock is an unprivileged Linux LSM: a process restricts ITSELF, and every
 * child inherits the restriction, with no capability and no root. That matters
 * here because the container drops every capability and sets no-new-privileges,
 * which rules out user namespaces, mounts and uid switching - and Landlock
 * needs none of them. It requires no_new_privs, which Docker already set.
 *
 * Rules are ALLOW rules on directory hierarchies. --ro grants read and execute
 * beneath a path, --rw grants everything beneath it, and anything not granted is
 * denied: a path nobody named - /cod, say - cannot be read, written or executed.
 *
 * Fails CLOSED. If the kernel has no Landlock this exits 78 rather than running
 * the program unconfined; the workspace can opt out explicitly
 * (`agentSandbox: "off"`), and then this binary is simply not used.
 *
 * Built static in the image (docker/Dockerfile.sandbox) so it depends on nothing
 * at run time. Kept small on purpose: it is the one piece of C in the project,
 * and every line of it is security-relevant.
 */

#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/landlock.h>
#include <linux/prctl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <unistd.h>

#define EXIT_UNAVAILABLE 78

#ifndef LANDLOCK_ACCESS_FS_REFER
#define LANDLOCK_ACCESS_FS_REFER (1ULL << 13)
#endif
#ifndef LANDLOCK_ACCESS_FS_TRUNCATE
#define LANDLOCK_ACCESS_FS_TRUNCATE (1ULL << 14)
#endif
#ifndef LANDLOCK_ACCESS_FS_IOCTL_DEV
#define LANDLOCK_ACCESS_FS_IOCTL_DEV (1ULL << 15)
#endif
#ifndef LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET
#define LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET (1ULL << 0)
#endif
#ifndef LANDLOCK_SCOPE_SIGNAL
#define LANDLOCK_SCOPE_SIGNAL (1ULL << 1)
#endif

/* A ruleset attr with the field ABI 6 added; older kernels read a prefix. */
struct cod_ruleset_attr {
  __u64 handled_access_fs;
  __u64 handled_access_net;
  __u64 scoped;
};

#define FS_READ (LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR)

#define FS_ALL_V1                                                                                     \
  (LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_READ_FILE |       \
   LANDLOCK_ACCESS_FS_READ_DIR | LANDLOCK_ACCESS_FS_REMOVE_DIR | LANDLOCK_ACCESS_FS_REMOVE_FILE |    \
   LANDLOCK_ACCESS_FS_MAKE_CHAR | LANDLOCK_ACCESS_FS_MAKE_DIR | LANDLOCK_ACCESS_FS_MAKE_REG |        \
   LANDLOCK_ACCESS_FS_MAKE_SOCK | LANDLOCK_ACCESS_FS_MAKE_FIFO | LANDLOCK_ACCESS_FS_MAKE_BLOCK |     \
   LANDLOCK_ACCESS_FS_MAKE_SYM)

/* The rights that make sense on a regular file rather than a directory. */
#define FS_FILE_ONLY                                                                                  \
  (LANDLOCK_ACCESS_FS_EXECUTE | LANDLOCK_ACCESS_FS_WRITE_FILE | LANDLOCK_ACCESS_FS_READ_FILE |       \
   LANDLOCK_ACCESS_FS_TRUNCATE | LANDLOCK_ACCESS_FS_IOCTL_DEV)

static __u64 handled_for_abi(long abi) {
  __u64 fs = FS_ALL_V1;
  if (abi >= 2) fs |= LANDLOCK_ACCESS_FS_REFER;
  if (abi >= 3) fs |= LANDLOCK_ACCESS_FS_TRUNCATE;
  if (abi >= 5) fs |= LANDLOCK_ACCESS_FS_IOCTL_DEV;
  return fs;
}

static long landlock_abi(void) {
  return syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
}

static void usage(void) {
  fprintf(stderr, "usage: cod-sandbox [--ro PATH]... [--rw PATH]... -- PROGRAM [ARG]...\n"
                  "       cod-sandbox --probe\n");
}

/* Allow `access` beneath `path`. A path that does not exist is skipped: it holds nothing to protect. */
static int allow(int ruleset, const char *path, __u64 access, __u64 handled) {
  int fd = open(path, O_PATH | O_CLOEXEC);
  if (fd < 0) {
    if (errno == ENOENT) return 0;
    fprintf(stderr, "cod-sandbox: cannot open %s: %s\n", path, strerror(errno));
    return -1;
  }
  struct stat st;
  if (fstat(fd, &st) != 0) {
    fprintf(stderr, "cod-sandbox: cannot stat %s: %s\n", path, strerror(errno));
    close(fd);
    return -1;
  }
  __u64 allowed = access & handled;
  if (!S_ISDIR(st.st_mode)) allowed &= FS_FILE_ONLY;
  struct landlock_path_beneath_attr rule = {.allowed_access = allowed, .parent_fd = fd};
  int rc = (int)syscall(SYS_landlock_add_rule, ruleset, LANDLOCK_RULE_PATH_BENEATH, &rule, 0);
  if (rc != 0) fprintf(stderr, "cod-sandbox: cannot add a rule for %s: %s\n", path, strerror(errno));
  close(fd);
  return rc;
}

int main(int argc, char **argv) {
  long abi = landlock_abi();

  if (argc == 2 && strcmp(argv[1], "--probe") == 0) {
    if (abi < 0) {
      printf("unavailable: %s\n", strerror(errno));
      return EXIT_UNAVAILABLE;
    }
    printf("landlock abi %ld\n", abi);
    return 0;
  }

  /* Parse --ro / --rw pairs up to "--". */
  int i = 1;
  int first_rule = 1;
  for (; i < argc; i++) {
    if (strcmp(argv[i], "--") == 0) break;
    if ((strcmp(argv[i], "--ro") == 0 || strcmp(argv[i], "--rw") == 0) && i + 1 < argc) {
      i++;
      continue;
    }
    usage();
    return 2;
  }
  if (i >= argc - 1) {
    usage();
    return 2;
  }
  int program = i + 1;

  if (abi < 0) {
    fprintf(stderr,
            "cod-sandbox: landlock is not available on this kernel (%s); refusing to run an agent "
            "unconfined. Set \"agentSandbox\": \"off\" in cod.json to accept that risk.\n",
            strerror(errno));
    return EXIT_UNAVAILABLE;
  }

  __u64 handled = handled_for_abi(abi);
  struct cod_ruleset_attr attr = {.handled_access_fs = handled, .handled_access_net = 0, .scoped = 0};
  size_t attr_size = sizeof(__u64) * 2; /* ABI 1-5 know two fields */
  if (abi >= 6) {
    /* Signals and abstract unix sockets stay inside the sandbox: an agent cannot
     * kill or talk to the supervisor that started it. */
    attr.scoped = LANDLOCK_SCOPE_SIGNAL | LANDLOCK_SCOPE_ABSTRACT_UNIX_SOCKET;
    attr_size = sizeof(attr);
  }
  int ruleset = (int)syscall(SYS_landlock_create_ruleset, &attr, attr_size, 0);
  if (ruleset < 0) {
    fprintf(stderr, "cod-sandbox: cannot create a landlock ruleset: %s\n", strerror(errno));
    return EXIT_UNAVAILABLE;
  }

  for (int k = first_rule; k < program - 1; k += 2) {
    __u64 access = strcmp(argv[k], "--rw") == 0 ? handled : FS_READ;
    if (allow(ruleset, argv[k + 1], access, handled) != 0) return EXIT_UNAVAILABLE;
  }

  if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0) {
    fprintf(stderr, "cod-sandbox: cannot set no_new_privs: %s\n", strerror(errno));
    return EXIT_UNAVAILABLE;
  }
  if (syscall(SYS_landlock_restrict_self, ruleset, 0) != 0) {
    fprintf(stderr, "cod-sandbox: cannot enter the sandbox: %s\n", strerror(errno));
    return EXIT_UNAVAILABLE;
  }
  close(ruleset);

  execvp(argv[program], &argv[program]);
  fprintf(stderr, "cod-sandbox: cannot run %s: %s\n", argv[program], strerror(errno));
  return 127;
}
