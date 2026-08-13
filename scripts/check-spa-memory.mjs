const endpoint = process.argv[2] || "http://127.0.0.1:9223";
const appUrl = process.argv[3] || "http://127.0.0.1:8300/#/M01001";
const rounds = Number.parseInt(process.argv[4] || "10", 10);
const refreshRounds = Number.parseInt(process.argv[5] || "12", 10);
const routes = ["M01001", "M02001", "M03001", "M04001", "M05001", "M05002"];

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class CdpClient {
    constructor(webSocketUrl) {
        this.socket = new WebSocket(webSocketUrl);
        this.sequence = 0;
        this.pending = new Map();
        this.ready = new Promise((resolve, reject) => {
            this.socket.addEventListener("open", resolve, { once: true });
            this.socket.addEventListener("error", reject, { once: true });
        });
        this.socket.addEventListener("message", (event) => {
            const message = JSON.parse(event.data);
            if (!message.id) return;
            const pending = this.pending.get(message.id);
            if (!pending) return;
            this.pending.delete(message.id);
            if (message.error) pending.reject(new Error(message.error.message));
            else pending.resolve(message.result);
        });
    }

    async send(method, params = {}) {
        await this.ready;
        const id = ++this.sequence;
        return new Promise((resolve, reject) => {
            this.pending.set(id, { resolve, reject });
            this.socket.send(JSON.stringify({ id, method, params }));
        });
    }

    close() {
        if (this.socket.readyState === WebSocket.OPEN || this.socket.readyState === WebSocket.CONNECTING) {
            this.socket.close();
        }
    }
}

async function createTarget(url) {
    const response = await fetch(`${endpoint}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    if (!response.ok) throw new Error(`Edge CDP target creation failed: ${response.status}`);
    return response.json();
}

async function evaluate(client, expression) {
    const result = await client.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true
    });
    if (result.exceptionDetails) {
        const message = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
        throw new Error(message);
    }
    return result.result.value;
}

async function waitFor(client, expression, timeoutMs = 10000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (await evaluate(client, expression)) return;
        await sleep(50);
    }
    throw new Error(`Timed out waiting for: ${expression}`);
}

async function routeTo(client, code) {
    const previousGeneration = await evaluate(client, `Number(document.querySelector(".route-view[data-route-generation]")?.dataset.routeGeneration || 0)`);
    await evaluate(client, `location.hash = ${JSON.stringify(`#/${code}`)}`);
    await waitFor(
        client,
        `Number(document.querySelector(".route-view[data-route-generation]")?.dataset.routeGeneration || 0) > ${previousGeneration}`
    );
    await sleep(180);
}

async function refreshPage(client) {
    const previousGeneration = await evaluate(client, `Number(document.querySelector(".route-view[data-route-generation]")?.dataset.routeGeneration || 0)`);
    await evaluate(client, `document.querySelector("[data-page-refresh]").click()`);
    await waitFor(
        client,
        `Number(document.querySelector(".route-view[data-route-generation]")?.dataset.routeGeneration || 0) > ${previousGeneration} && !document.querySelector("[data-page-refresh]").disabled`
    );
    await sleep(120);
}

async function heapUsage(client) {
    await client.send("HeapProfiler.collectGarbage");
    await sleep(100);
    const usage = await client.send("Runtime.getHeapUsage");
    return Math.round(usage.usedSize);
}

function megabytes(bytes) {
    return Math.round((bytes / 1024 / 1024) * 100) / 100;
}

let target;
let client;
try {
    target = await createTarget(appUrl);
    client = new CdpClient(target.webSocketDebuggerUrl);
    await client.send("Page.enable");
    await client.send("Runtime.enable");
    await client.send("HeapProfiler.enable");
    const navigation = await client.send("Page.navigate", { url: appUrl });
    if (navigation.errorText) throw new Error(`Page navigation failed: ${navigation.errorText}`);
    try {
        await waitFor(client, `Boolean(window.SurveyOneApp && document.querySelector(".route-view[data-route-generation]"))`, 15000);
    } catch (error) {
        const bootState = await evaluate(client, `({
            href: location.href,
            readyState: document.readyState,
            title: document.title,
            hasApp: Boolean(window.SurveyOneApp),
            hasRouteRoot: Boolean(document.querySelector(".route-view[data-route-generation]")),
            bodyText: document.body?.innerText?.slice(0, 300) || ""
        })`);
        throw new Error(`${error.message}; boot state=${JSON.stringify(bootState)}`);
    }

    const signupResult = await evaluate(client, `(async () => {
        const loginId = "memorycheck" + Date.now();
        const response = await fetch("/api/auth/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                loginId,
                password: "MemoryCheck!2026",
                name: "Memory Check",
                organizationName: "Lifecycle Test",
                email: null,
                termsAccepted: true,
                privacyAccepted: true,
                requestSystemAdmin: false
            })
        });
        return { ok: response.ok, status: response.status, body: await response.text() };
    })()`);
    if (!signupResult.ok) throw new Error(`Test signup failed (${signupResult.status}): ${signupResult.body}`);

    for (const code of routes.slice(1)) await routeTo(client, code);
    const navigationBaseline = await heapUsage(client);
    const navigationSamples = [];
    for (let round = 0; round < rounds; round += 1) {
        for (const code of routes) await routeTo(client, code);
        navigationSamples.push(await heapUsage(client));
    }
    const navigationFinal = navigationSamples.at(-1) || navigationBaseline;

    await routeTo(client, "M02001");
    const refreshBaseline = await heapUsage(client);
    const refreshSamples = [];
    for (let round = 0; round < refreshRounds; round += 1) {
        await refreshPage(client);
        refreshSamples.push(await heapUsage(client));
    }
    const refreshFinal = refreshSamples.at(-1) || refreshBaseline;

    const dom = await evaluate(client, `({
        pageScripts: document.querySelectorAll("script[data-page-script]").length,
        pageStyles: document.querySelectorAll("link[data-page-style]").length,
        routeRoots: document.querySelectorAll(".route-view[data-route-generation]").length,
        modalChildren: document.querySelector("[data-modal-body]")?.childElementCount || 0,
        currentHash: location.hash
    })`);
    const navigationGrowth = navigationFinal - navigationBaseline;
    const refreshGrowth = refreshFinal - refreshBaseline;
    const maxAllowedNavigationGrowth = Math.max(4 * 1024 * 1024, navigationBaseline * 0.3);
    const maxAllowedRefreshGrowth = Math.max(3 * 1024 * 1024, refreshBaseline * 0.25);
    const boundedDom = dom.pageScripts <= routes.length && dom.pageStyles === 1 && dom.routeRoots === 1 && dom.modalChildren === 0;
    const boundedHeap = navigationGrowth <= maxAllowedNavigationGrowth && refreshGrowth <= maxAllowedRefreshGrowth;

    const report = {
        result: boundedDom && boundedHeap ? "pass" : "fail",
        routes,
        navigation: {
            rounds,
            transitions: rounds * routes.length,
            baselineMb: megabytes(navigationBaseline),
            finalMb: megabytes(navigationFinal),
            growthMb: megabytes(navigationGrowth),
            samplesMb: navigationSamples.map(megabytes)
        },
        explicitRefresh: {
            rounds: refreshRounds,
            baselineMb: megabytes(refreshBaseline),
            finalMb: megabytes(refreshFinal),
            growthMb: megabytes(refreshGrowth),
            samplesMb: refreshSamples.map(megabytes)
        },
        dom
    };
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.result !== "pass") process.exitCode = 1;
} finally {
    if (target?.id) {
        await fetch(`${endpoint}/json/close/${encodeURIComponent(target.id)}`).catch(() => undefined);
    }
    await sleep(100);
    client?.close();
}
