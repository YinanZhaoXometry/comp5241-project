/* Trusted TXT-only copier. Never interprets document instructions or opens paths.
 * macOS Seatbelt denies network, filesystem, process creation and IPC after entry.
 * This is not the future document-parser or learner-code sandbox. */
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <sandbox.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <unistd.h>

static void limit(int resource, rlim_t value) {
  struct rlimit bound = {value, value};
  if (setrlimit(resource, &bound)) { fprintf(stderr, "resource=%d errno=%d\n", resource, errno); _exit(70); }
}
int main(int argc, char **argv) {
  limit(RLIMIT_CPU, 2);
  /* Darwin rejects small DATA/AS limits on this arm64 host. The copier has one
   * fixed 20MiB+1 allocation and checks peak RSS below; no general parser runs. */
  limit(RLIMIT_NOFILE, 16);
  limit(RLIMIT_CORE, 0);
  char *error = NULL;
  if (sandbox_init("(version 1)(deny default)", 0, &error)) return 71;
  if (argc == 2 && !strcmp(argv[1], "--probe")) {
    /* Seatbelt controls connect, not socket allocation. Only target loopback. */
    int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) return 72;
    struct sockaddr_in address = {0};
    address.sin_family = AF_INET;
    address.sin_port = htons(55432);
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    int connected = connect(fd, (struct sockaddr *)&address, sizeof(address));
    int refused = errno == EPERM || errno == EACCES;
    close(fd);
    if (connected == 0 || !refused) return 72;
    fd = open("/etc/hosts", O_RDONLY);
    if (fd >= 0) { close(fd); return 73; }
    fd = open("/tmp/tracer-sandbox-probe", O_WRONLY | O_CREAT, 0600);
    if (fd >= 0) { close(fd); return 74; }
    return 0;
  }
  const size_t maximum = 20 * 1024 * 1024;
  unsigned char *bytes = malloc(maximum + 1);
  if (!bytes) return 75;
  size_t size = 0;
  for (;;) {
    size_t remaining = maximum + 1 - size;
    ssize_t count = read(STDIN_FILENO, bytes + size, remaining < 65536 ? remaining : 65536);
    if (count < 0) { if (errno == EINTR) continue; return 76; }
    if (!count) break;
    size += (size_t)count;
    if (size > maximum) return 77;
    struct rusage usage;
    if (getrusage(RUSAGE_SELF, &usage) || usage.ru_maxrss > 128 * 1024 * 1024) return 80;
  }
  if (!size) return 78;
  size_t sent = 0;
  while (sent < size) {
    ssize_t count = write(STDOUT_FILENO, bytes + sent, size - sent);
    if (count <= 0) { if (errno == EINTR) continue; return 79; }
    sent += (size_t)count;
  }
  free(bytes);
  return 0;
}