// Frees the dev port before `next dev` starts.
//
// When a stale dev server still owns port 3000, Next quietly moves to 3001,
// prints a "Ready" banner for 3001, and *then* exits — because another dev
// server already holds this project's .next directory. The URL it just printed
// is dead by the time you open it, which looks exactly like "the app won't
// load". Stopping the stale listener first keeps the printed URL truthful.
import { execFileSync } from "node:child_process";

const port = Number(process.argv[2] ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error(`free-port: "${process.argv[2]}" is not a valid port`);
  process.exit(1);
}

function listeningPids() {
  try {
    return execFileSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch {
    // lsof exits non-zero when nothing is listening, and is absent on Windows.
    // Either way there is nothing for us to clean up.
    return [];
  }
}

const stale = listeningPids();

for (const pid of stale) {
  try {
    process.kill(pid, "SIGTERM");
    console.log(`free-port: stopped stale dev server on :${port} (pid ${pid})`);
  } catch (error) {
    if (error.code !== "ESRCH") {
      console.error(`free-port: could not stop pid ${pid} on :${port} — ${error.message}`);
    }
  }
}

// SIGTERM is asynchronous; give the socket a moment to actually close so Next
// does not still see the port as taken and drift to 3001 anyway.
if (stale.length) {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline && listeningPids().length) {
    execFileSync("sleep", ["0.1"]);
  }
  if (listeningPids().length) {
    console.error(`free-port: :${port} is still held — run "lsof -nP -iTCP:${port} -sTCP:LISTEN" to inspect it`);
  }
}
