const VSHADER_SOURCE = `
attribute vec4 a_Position;
attribute vec3 a_Normal;
attribute vec2 a_TexCoord;
attribute vec3 a_Tangent;
uniform mat4 u_MvpMatrix;
uniform mat4 u_modelMatrix;
varying vec3 v_PositionInWorld;
varying vec3 v_Normal;
varying vec2 v_TexCoord;
varying vec3 v_Tangent;
void main() {
    gl_Position = u_MvpMatrix * a_Position;
    v_PositionInWorld = (u_modelMatrix * a_Position).xyz;
    v_Normal = normalize(mat3(u_modelMatrix) * a_Normal);
    v_Tangent = normalize(mat3(u_modelMatrix) * a_Tangent);
    v_TexCoord = a_TexCoord;
}
`;

const FSHADER_SOURCE = `
precision mediump float;
uniform vec3 u_LightPosition;
uniform vec3 u_ViewPosition;
uniform vec3 u_Color;
uniform float u_Ka;
uniform float u_Kd;
uniform float u_Ks;
uniform float u_shininess;
uniform sampler2D u_Sampler0;
uniform sampler2D u_NormalMap;
uniform bool u_useTexture;
uniform bool u_useBump;
varying vec3 v_PositionInWorld;
varying vec3 v_Normal;
varying vec2 v_TexCoord;
varying vec3 v_Tangent;
void main() {
    vec3 baseColor = u_Color;
    if (u_useTexture) {
        baseColor *= texture2D(u_Sampler0, v_TexCoord).rgb;
    }

    vec3 normal = normalize(v_Normal);
    if (u_useBump) {
        vec3 tangent = normalize(v_Tangent);
        vec3 bitangent = normalize(cross(normal, tangent));
        mat3 tbn = mat3(tangent, bitangent, normal);
        vec3 mapNormal = texture2D(u_NormalMap, v_TexCoord * 2.5).rgb * 2.0 - 1.0;
        normal = normalize(tbn * mapNormal);
    }

    vec3 ambient = baseColor * u_Ka;
    vec3 lightDirection = normalize(u_LightPosition - v_PositionInWorld);
    float nDotL = max(dot(lightDirection, normal), 0.0);
    vec3 diffuse = baseColor * u_Kd * nDotL;

    vec3 specular = vec3(0.0);
    if (nDotL > 0.0) {
        vec3 R = reflect(-lightDirection, normal);
        vec3 V = normalize(u_ViewPosition - v_PositionInWorld);
        float specAngle = clamp(dot(R, V), 0.0, 1.0);
        specular = vec3(1.0) * u_Ks * pow(specAngle, u_shininess);
    }
    gl_FragColor = vec4(ambient + diffuse + specular, 1.0);
}
`;

const VSHADER_REFLECT = `
attribute vec4 a_Position;
attribute vec3 a_Normal;
uniform mat4 u_MvpMatrix;
uniform mat4 u_modelMatrix;
varying vec3 v_PositionInWorld;
varying vec3 v_Normal;
void main() {
    gl_Position = u_MvpMatrix * a_Position;
    v_PositionInWorld = (u_modelMatrix * a_Position).xyz;
    v_Normal = normalize(mat3(u_modelMatrix) * a_Normal);
}
`;

const FSHADER_REFLECT = `
precision mediump float;
uniform samplerCube u_envCubeMap;
uniform vec3 u_ViewPosition;
uniform vec3 u_Tint;
varying vec3 v_PositionInWorld;
varying vec3 v_Normal;
void main() {
    vec3 V = normalize(u_ViewPosition - v_PositionInWorld);
    vec3 R = reflect(-V, normalize(v_Normal));
    vec3 env = textureCube(u_envCubeMap, R).rgb;
    gl_FragColor = vec4(env * 0.85 + u_Tint * 0.45, 1.0);
}
`;

const VSHADER_SKYBOX = `
attribute vec4 a_Position;
varying vec4 v_Position;
void main() {
    v_Position = a_Position;
    gl_Position = a_Position;
}
`;

const FSHADER_SKYBOX = `
precision mediump float;
uniform samplerCube u_envCubeMap;
uniform mat4 u_viewDirectionProjectionInverse;
varying vec4 v_Position;
void main() {
    vec4 t = u_viewDirectionProjectionInverse * v_Position;
    gl_FragColor = textureCube(u_envCubeMap, normalize(t.xyz / t.w));
}
`;

const VSHADER_FLAT = `
attribute vec4 a_Position;
uniform mat4 u_MvpMatrix;
varying vec2 v_ScreenPos;
void main() {
    gl_Position = u_MvpMatrix * a_Position;
    v_ScreenPos = a_Position.xy;
}
`;

const FSHADER_FLAT = `
precision mediump float;
uniform vec4 u_Color;
uniform bool u_useRing;
uniform float u_ringProgress;
varying vec2 v_ScreenPos;
void main() {
    if (u_useRing) {
        float d = length(v_ScreenPos);
        float radius = mix(0.12, 1.28, u_ringProgress);
        float width = 0.13 + 0.08 * (1.0 - u_ringProgress);
        float ring = smoothstep(width, 0.0, abs(d - radius));
        float wash = smoothstep(1.2, 0.0, d) * 0.18 * (1.0 - u_ringProgress);
        gl_FragColor = vec4(u_Color.rgb, u_Color.a * max(ring, wash));
    } else {
        gl_FragColor = u_Color;
    }
}
`;

const maze = [
    "#############",
    "#.....#.....#",
    "#.###.#.###.#",
    "#.#.......#.#",
    "#.#.##.##.#.#",
    "#...#...#...#",
    "###...#...###",
    "#...#...#...#",
    "#.#.##.##.#.#",
    "#.#.......#.#",
    "#.###.#.###.#",
    "#.....#.....#",
    "#############",
];

const cellSize = 2.0;
const halfRows = (maze.length - 1) / 2;
const halfCols = (maze[0].length - 1) / 2;
const shardStart = [
    { r: 1, c: 1 }, { r: 1, c: 11 }, { r: 5, c: 6 }, { r: 11, c: 1 }, { r: 11, c: 11 },
];
const powerStart = [
    { type: "reveal", r: 3, c: 5 },
    { type: "speed", r: 9, c: 7 },
    { type: "speed", r: 6, c: 3 },
];

let gl;
let canvas;
let program;
let reflectProgram;
let skyboxProgram;
let flatProgram;
let cubeObj;
let quadObj;
let cubeMapTex;
let normalMapTex;
let checkerTex;
let wallTex;
let floorTex;
let whiteTex;
let enemyObj = [];
let playerArrowObj;
let lastTime = 0;
let started = false;
let animationId = 0;
let ringEffects = [];
const sounds = {};
const soundFiles = {
    shard: "sound/get-chard.wav",
    speed: "sound/speed-boost.wav",
    reveal: "sound/look.mp3",
    success: "sound/success.wav",
    failed: "sound/failed.wav",
};

const keys = {};
const player = { x: -10, z: 10, yaw: Math.PI * 0.25, pitch: 0, radius: 0.33, speed: 3.1 };
const enemy = { x: 10, z: -2, yaw: 0, radius: 0.42, speed: 2.5 };
let shards = [];
let powerups = [];
let collected = 0;
let revealTimer = 0;
let speedTimer = 0;
let gameState = "menu";

document.addEventListener("DOMContentLoaded", () => {
    const mainMenu = document.getElementById("main-menu");
    const resultPanel = document.getElementById("result-panel");
    const hud = document.getElementById("hud");

    function hideAllPanels() {
        mainMenu.classList.add("hidden");
        resultPanel.classList.add("hidden");
    }

    document.getElementById("btn-start").addEventListener("click", async () => {
        hideAllPanels();
        hud.classList.remove("hidden");
        document.getElementById("ui-layer").style.pointerEvents = "none";
        await startGame();
    });

    document.getElementById("btn-restart").addEventListener("click", async () => {
        hideAllPanels();
        hud.classList.remove("hidden");
        document.getElementById("ui-layer").style.pointerEvents = "none";
        await startGame();
    });

    document.getElementById("btn-result-menu").addEventListener("click", () => {
        cancelAnimationFrame(animationId);
        gameState = "menu";
        started = false;
        hud.classList.add("hidden");
        document.getElementById("ui-layer").style.pointerEvents = "auto";
        hideAllPanels();
        mainMenu.classList.remove("hidden");
    });

    if (new URLSearchParams(location.search).get("autostart") === "1") {
        document.getElementById("btn-start").click();
    }
});

async function startGame() {
    if (!started) {
        await initWebGL();
        started = true;
    }
    resetGame();
    gameState = "playing";
    lastTime = performance.now();
    if (canvas.requestPointerLock) canvas.requestPointerLock();
    cancelAnimationFrame(animationId);
    tick(lastTime);
}

async function initWebGL() {
    canvas = document.getElementById("glcanvas");
    gl = canvas.getContext("webgl2");
    if (!gl) {
        alert("WebGL2 is not available in this browser.");
        return;
    }

    initSounds();

    cubeObj = initVertexBufferForLaterUse(gl, createCubeData());
    playerArrowObj = initVertexBufferForLaterUse(gl, createArrowData());
    quadObj = initVertexBufferForLaterUse(gl, {
        positions: [-1, -1, 1, 1, -1, 1, -1, 1, 1, -1, 1, 1, 1, -1, 1, 1, 1, 1],
    });

    program = compileShader(gl, VSHADER_SOURCE, FSHADER_SOURCE);
    program.a_Position = gl.getAttribLocation(program, "a_Position");
    program.a_Normal = gl.getAttribLocation(program, "a_Normal");
    program.a_TexCoord = gl.getAttribLocation(program, "a_TexCoord");
    program.a_Tangent = gl.getAttribLocation(program, "a_Tangent");
    program.u_MvpMatrix = gl.getUniformLocation(program, "u_MvpMatrix");
    program.u_modelMatrix = gl.getUniformLocation(program, "u_modelMatrix");
    program.u_LightPosition = gl.getUniformLocation(program, "u_LightPosition");
    program.u_ViewPosition = gl.getUniformLocation(program, "u_ViewPosition");
    program.u_Color = gl.getUniformLocation(program, "u_Color");
    program.u_Ka = gl.getUniformLocation(program, "u_Ka");
    program.u_Kd = gl.getUniformLocation(program, "u_Kd");
    program.u_Ks = gl.getUniformLocation(program, "u_Ks");
    program.u_shininess = gl.getUniformLocation(program, "u_shininess");
    program.u_Sampler0 = gl.getUniformLocation(program, "u_Sampler0");
    program.u_NormalMap = gl.getUniformLocation(program, "u_NormalMap");
    program.u_useTexture = gl.getUniformLocation(program, "u_useTexture");
    program.u_useBump = gl.getUniformLocation(program, "u_useBump");

    reflectProgram = compileShader(gl, VSHADER_REFLECT, FSHADER_REFLECT);
    reflectProgram.a_Position = gl.getAttribLocation(reflectProgram, "a_Position");
    reflectProgram.a_Normal = gl.getAttribLocation(reflectProgram, "a_Normal");
    reflectProgram.u_MvpMatrix = gl.getUniformLocation(reflectProgram, "u_MvpMatrix");
    reflectProgram.u_modelMatrix = gl.getUniformLocation(reflectProgram, "u_modelMatrix");
    reflectProgram.u_envCubeMap = gl.getUniformLocation(reflectProgram, "u_envCubeMap");
    reflectProgram.u_ViewPosition = gl.getUniformLocation(reflectProgram, "u_ViewPosition");
    reflectProgram.u_Tint = gl.getUniformLocation(reflectProgram, "u_Tint");

    skyboxProgram = compileShader(gl, VSHADER_SKYBOX, FSHADER_SKYBOX);
    skyboxProgram.a_Position = gl.getAttribLocation(skyboxProgram, "a_Position");
    skyboxProgram.u_envCubeMap = gl.getUniformLocation(skyboxProgram, "u_envCubeMap");
    skyboxProgram.u_viewDirectionProjectionInverse = gl.getUniformLocation(skyboxProgram, "u_viewDirectionProjectionInverse");

    flatProgram = compileShader(gl, VSHADER_FLAT, FSHADER_FLAT);
    flatProgram.a_Position = gl.getAttribLocation(flatProgram, "a_Position");
    flatProgram.u_MvpMatrix = gl.getUniformLocation(flatProgram, "u_MvpMatrix");
    flatProgram.u_Color = gl.getUniformLocation(flatProgram, "u_Color");
    flatProgram.u_useRing = gl.getUniformLocation(flatProgram, "u_useRing");
    flatProgram.u_ringProgress = gl.getUniformLocation(flatProgram, "u_ringProgress");

    checkerTex = createCheckerTexture();
    wallTex = checkerTex;
    floorTex = checkerTex;
    whiteTex = createColorTexture([255, 255, 255, 255]);
    normalMapTex = createColorTexture([128, 128, 255, 255]);
    loadTexture2D("texture/normalMap.jpeg", (tex) => { normalMapTex = tex; });
    loadTexture2D("texture/wall.jpg", (tex) => { wallTex = tex; });
    loadTexture2D("texture/floor.jpg", (tex) => { floorTex = tex; });
    cubeMapTex = initCubeTexture("texture/pos-x.jpg", "texture/neg-x.jpg", "texture/pos-y.jpg", "texture/neg-y.jpg", "texture/pos-z.jpg", "texture/neg-z.jpg");
    enemyObj = await loadOBJtoCreateVBO("Slime.obj");

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);

    window.addEventListener("keydown", (ev) => { keys[ev.key.toLowerCase()] = true; });
    window.addEventListener("keyup", (ev) => { keys[ev.key.toLowerCase()] = false; });
    document.addEventListener("mousemove", mouseLook);
    canvas.addEventListener("click", () => {
        if (gameState === "playing" && canvas.requestPointerLock) canvas.requestPointerLock();
    });
}

function resetGame() {
    const spawn = createRandomSpawnLayout();
    player.x = spawn.player.x;
    player.z = spawn.player.z;
    player.yaw = spawn.player.yaw;
    player.pitch = 0;
    enemy.x = spawn.enemy.x;
    enemy.z = spawn.enemy.z;
    enemy.yaw = 0;
    collected = 0;
    revealTimer = 0;
    speedTimer = 0;
    ringEffects = [];
    shards = spawn.shards.map((p, i) => ({ ...p, taken: false, angle: i * 0.7 }));
    powerups = spawn.powerups.map((p) => ({ ...p, taken: false }));
    updateHud("Find 5 shards before the pursuer catches you.");
}

function createRandomSpawnLayout() {
    const used = [];
    const cells = getOpenCells();
    const playerCell = pickOpenCell(cells, used);
    used.push({ ...playerCell, minDistance: cellSize * 1.25 });

    const enemyCell = pickOpenCell(cells, used, cellSize * 7.0);
    used.push({ ...enemyCell, minDistance: cellSize * 2.0 });

    const shardCells = [];
    for (let i = 0; i < shardStart.length; i++) {
        const cell = pickOpenCell(cells, used, cellSize * 1.45);
        shardCells.push(cell);
        used.push({ ...cell, minDistance: cellSize * 1.25 });
    }

    const powerCells = powerStart.map((power) => {
        const cell = pickOpenCell(cells, used, cellSize * 1.45);
        used.push({ ...cell, minDistance: cellSize * 1.25 });
        return { type: power.type, ...cell };
    });

    return {
        player: { ...playerCell, yaw: randomCardinalYaw() },
        enemy: enemyCell,
        shards: shardCells,
        powerups: powerCells,
    };
}

function getOpenCells() {
    const cells = [];
    for (let r = 0; r < maze.length; r++) {
        for (let c = 0; c < maze[r].length; c++) {
            if (maze[r][c] !== ".") continue;
            cells.push(worldFromCell(r, c));
        }
    }
    return cells;
}

function pickOpenCell(cells, used, preferredMinDistance = cellSize * 1.25) {
    const shuffled = [...cells].sort(() => Math.random() - 0.5);
    const fits = (cell, scale) => used.every((other) => distance2D(cell, other) >= Math.max(preferredMinDistance, other.minDistance || preferredMinDistance) * scale);
    return shuffled.find((cell) => fits(cell, 1.0))
        || shuffled.find((cell) => fits(cell, 0.65))
        || shuffled[0];
}

function randomCardinalYaw() {
    const dirs = [0, Math.PI * 0.5, Math.PI, -Math.PI * 0.5];
    return dirs[Math.floor(Math.random() * dirs.length)];
}

function tick(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.04);
    lastTime = now;
    if (gameState === "playing") updateGame(dt);
    draw();
    animationId = requestAnimationFrame(tick);
}

function updateGame(dt) {
    const boost = speedTimer > 0 ? 1.75 : 1.0;
    const speed = player.speed * boost;
    let forward = 0;
    let strafe = 0;
    if (keys.w) forward += 1;
    if (keys.s) forward -= 1;
    if (keys.d) strafe -= 1;
    if (keys.a) strafe += 1;
    const len = Math.hypot(forward, strafe) || 1;
    const sin = Math.sin(player.yaw);
    const cos = Math.cos(player.yaw);
    const dx = ((sin * forward + cos * strafe) / len) * speed * dt;
    const dz = ((cos * forward - sin * strafe) / len) * speed * dt;
    moveEntity(player, dx, dz);

    updateEnemy(dt);
    collectItems();
    revealTimer = Math.max(0, revealTimer - dt);
    speedTimer = Math.max(0, speedTimer - dt);
    ringEffects.forEach((effect) => {
        effect.time = Math.max(0, effect.time - dt);
    });
    ringEffects = ringEffects.filter((effect) => effect.time > 0);
    updateHud();

    if (distance2D(player, enemy) < player.radius + enemy.radius) {
        finishGame(false, "The pursuer caught you.\nTry a sharper route through the maze.");
    }
    if (collected >= 5) {
        finishGame(true, "All 5 shards are collected.\nYou escaped the maze.");
    }
}

function updateEnemy(dt) {
    const next = getNextEnemyTarget();
    const dx = next.x - enemy.x;
    const dz = next.z - enemy.z;
    const len = Math.hypot(dx, dz) || 1;
    const step = enemy.speed * dt;
    if (len > 0.05) enemy.yaw = Math.atan2(dx, dz);
    moveEntity(enemy, (dx / len) * step, (dz / len) * step);
}

function getNextEnemyTarget() {
    const start = cellFromWorld(enemy.x, enemy.z);
    const goal = cellFromWorld(player.x, player.z);
    const key = (r, c) => `${r},${c}`;
    const queue = [start];
    const visited = new Set([key(start.r, start.c)]);
    const parent = {};
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];

    while (queue.length) {
        const cur = queue.shift();
        if (cur.r === goal.r && cur.c === goal.c) break;
        dirs.forEach(([dr, dc]) => {
            const nr = cur.r + dr;
            const nc = cur.c + dc;
            const k = key(nr, nc);
            if (nr < 0 || nc < 0 || nr >= maze.length || nc >= maze[0].length) return;
            if (maze[nr][nc] === "#" || visited.has(k)) return;
            visited.add(k);
            parent[k] = cur;
            queue.push({ r: nr, c: nc });
        });
    }

    let step = goal;
    let prev = parent[key(step.r, step.c)];
    if (!prev) return { x: player.x, z: player.z };
    while (prev && !(prev.r === start.r && prev.c === start.c)) {
        step = prev;
        prev = parent[key(step.r, step.c)];
    }
    return worldFromCell(step.r, step.c);
}

function collectItems() {
    shards.forEach((shard) => {
        shard.angle += 0.03;
        if (!shard.taken && distance2D(player, shard) < 0.85) {
            shard.taken = true;
            collected++;
            playSound("shard");
            addRingEffect([1.0, 0.88, 0.16], 1.0);
            updateHud("Shard collected.");
        }
    });

    powerups.forEach((item) => {
        if (!item.taken && distance2D(player, item) < 0.9) {
            item.taken = true;
            if (item.type === "reveal") {
                revealTimer = 8;
                playSound("reveal");
                addRingEffect([0.1, 0.75, 1.0], revealTimer);
                updateHud("Reveal active: shards and pursuer appear on the map.");
            } else {
                speedTimer = 7;
                playSound("speed");
                addRingEffect([0.1, 1.0, 0.38], speedTimer);
                updateHud("Speed boost active.");
            }
        }
    });
}

function addRingEffect(color, duration) {
    ringEffects.push({ color, duration, time: duration });
}

function initSounds() {
    Object.entries(soundFiles).forEach(([key, file]) => {
        const audio = new Audio(file);
        audio.preload = "auto";
        audio.volume = key === "failed" || key === "success" ? 0.75 : 0.55;
        sounds[key] = audio;
    });
}

function playSound(key) {
    const base = sounds[key];
    if (!base) return;
    const audio = base.cloneNode();
    audio.volume = base.volume;
    audio.play().catch(() => {});
}

function finishGame(won, detail) {
    gameState = won ? "won" : "lost";
    playSound(won ? "success" : "failed");
    document.exitPointerLock?.();
    document.getElementById("ui-layer").style.pointerEvents = "auto";
    const resultPanel = document.getElementById("result-panel");
    resultPanel.classList.remove("result-win", "result-lose");
    resultPanel.classList.add(won ? "result-win" : "result-lose");
    document.getElementById("result-title").textContent = won ? "You Win" : "Game Over";
    document.getElementById("result-detail").textContent = detail;
    resultPanel.classList.remove("hidden");
}

function updateHud(message) {
    document.getElementById("score-board").textContent = `Shards ${collected} / 5`;
    if (message) document.getElementById("status-line").textContent = message;
    const buffs = [];
    if (revealTimer > 0) buffs.push(`Reveal ${revealTimer.toFixed(1)}s`);
    if (speedTimer > 0) buffs.push(`Speed ${speedTimer.toFixed(1)}s`);
    document.getElementById("buff-line").textContent = buffs.join("   ");
}

function draw() {
    if (!gl) return;
    resizeCanvasToDisplaySize();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.scissor(0, 0, canvas.width, canvas.height);
    gl.disable(gl.SCISSOR_TEST);
    gl.clearColor(0.02, 0.02, 0.035, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const mainView = getFirstPersonView();
    drawSkybox(mainView.viewDir, 0, 0, canvas.width, canvas.height, 65, canvas.width / canvas.height);
    drawScene(mainView.vp, true, false, mainView.eye, true);

    gl.enable(gl.SCISSOR_TEST);
    const mapX = 18;
    const mapW = 260;
    const mapH = 220;
    const mapY = canvas.height - mapH - 18;
    gl.viewport(mapX, mapY, mapW, mapH);
    gl.scissor(mapX, mapY, mapW, mapH);
    gl.clearColor(0.025, 0.028, 0.04, 0.92);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const mapView = getMapView();
    drawScene(mapView.vp, false, revealTimer > 0, mapView.eye, false);
    gl.disable(gl.SCISSOR_TEST);

    drawRingEffects();
}

function drawScene(vpMatrix, mainView, revealOnMap, eye, showShadows) {
    const light = [0, 7, 0];
    const mapMode = !mainView;
    const floorKa = mapMode ? 0.75 : 0.18;
    const floorKd = mapMode ? 0.25 : 0.74;
    const wallKa = mapMode ? 0.75 : 0.2;
    const wallKd = mapMode ? 0.25 : 0.72;
    drawCube(vpMatrix, modelMatrix(0, -0.08, 0, 0, [maze[0].length * cellSize, 0.12, maze.length * cellSize]), [0.5, 0.5, 0.58], floorTex, true, true, eye, light, floorKa, floorKd, 0.2, 12);

    for (let r = 0; r < maze.length; r++) {
        for (let c = 0; c < maze[r].length; c++) {
            if (maze[r][c] !== "#") continue;
            const p = worldFromCell(r, c);
            drawCube(vpMatrix, modelMatrix(p.x, 0.95, p.z, 0, [cellSize, 2.05, cellSize]), [0.85, 0.85, 0.9], wallTex, true, true, eye, light, wallKa, wallKd, 0.18, 20);
        }
    }

    if (showShadows) drawShadows(vpMatrix);

    if (mainView || revealOnMap) {
        shards.forEach((s) => {
            if (s.taken) return;
            drawReflectiveCube(vpMatrix, modelMatrix(s.x, 0.62, s.z, s.angle, [0.52, 0.52, 0.52]), [1.0, 0.08, 0.04], eye);
        });
        drawEnemy(vpMatrix, eye, light);
    }

    if (mainView) {
        powerups.forEach((p) => {
            if (p.taken) return;
            const color = p.type === "reveal" ? [0.1, 0.75, 1.0] : [0.1, 1.0, 0.38];
            drawCube(vpMatrix, modelMatrix(p.x, 0.35, p.z, performance.now() * 0.002, [0.45, 0.45, 0.45]), color, whiteTex, false, false, eye, light, 0.32, 0.74, 0.72, 45);
        });
    }

    if (!mainView) {
        drawPlayer(vpMatrix, eye, light);
    }
}

function drawEnemy(vpMatrix, eye, light) {
    const bob = Math.sin(performance.now() * 0.006) * 0.08;
    drawObject(enemyObj, vpMatrix, modelMatrix(enemy.x, -0.12 + bob, enemy.z, enemy.yaw - Math.PI/3.3, [0.42, 0.42, 0.42]), [0.7, 1.0, 0.24], whiteTex, false, false, eye, light, 0.22, 0.74, 0.55, 28);
}

function drawPlayer(vpMatrix, eye, light) {
    drawPlayerArrow(vpMatrix);
}

function drawPlayerArrow(vpMatrix) {
    gl.disable(gl.CULL_FACE);
    drawFlatObject([playerArrowObj], vpMatrix, modelMatrix(player.x, 0.18, player.z, player.yaw, [1.35, 1.0, 1.35]), [1.0, 0.9, 0.15, 1.0]);
    gl.enable(gl.CULL_FACE);
}

function drawShadows(vpMatrix) {
    const enemyBob = Math.sin(performance.now() * 0.006) * 0.08;
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    drawProjectedShadow(enemyObj, vpMatrix, modelMatrix(enemy.x, -0.12 + enemyBob, enemy.z, enemy.yaw - Math.PI/3.3, [0.42, 0.42, 0.42]), [0, 7, 0, 1], [0, 0, 0, 0.35]);
    shards.forEach((s) => {
        if (!s.taken) drawProjectedShadow([cubeObj], vpMatrix, modelMatrix(s.x, 0.62, s.z, s.angle, [0.52, 0.52, 0.52]), [0, 7, 0, 1], [0, 0, 0, 0.2]);
    });
    powerups.forEach((p) => {
        if (!p.taken) drawProjectedShadow([cubeObj], vpMatrix, modelMatrix(p.x, 0.35, p.z, performance.now() * 0.002, [0.45, 0.45, 0.45]), [0, 7, 0, 1], [0, 0, 0, 0.22]);
    });
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.enable(gl.CULL_FACE);
}

function drawProjectedShadow(obj, vp, model, light, color) {
    const shadowMatrix = new Matrix4();
    shadowMatrix.setIdentity();
    shadowMatrix.dropShadow([0, 1, 0, -0.015], light);
    const shadowModel = new Matrix4(shadowMatrix);
    shadowModel.multiply(new Matrix4({ elements: model }));
    drawFlatObject(obj, vp, shadowModel.elements, color);
}

function drawRingEffects() {
    if (!ringEffects.length) return;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(flatProgram);
    const identity = mat4Identity();
    gl.uniformMatrix4fv(flatProgram.u_MvpMatrix, false, identity);
    gl.uniform1i(flatProgram.u_useRing, 0);
    initAttributeVariable(gl, flatProgram.a_Position, quadObj.vertexBuffer);
    ringEffects.forEach((effect) => {
        const progress = 1.0 - effect.time / effect.duration;
        const pulse = 0.65 + 0.35 * Math.sin(progress * Math.PI * 12.0);
        const alpha = 0.44 * (1.0 - progress * 0.75) * pulse;
        gl.uniform4f(flatProgram.u_Color, effect.color[0], effect.color[1], effect.color[2], alpha);
        drawScreenBorderQuads();
    });
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
}

function drawScreenBorderQuads() {
    const thickness = Math.max(16, Math.floor(Math.min(canvas.width, canvas.height) * 0.045));
    const strips = [
        [0, canvas.height - thickness, canvas.width, thickness],
        [0, 0, canvas.width, thickness],
        [0, 0, thickness, canvas.height],
        [canvas.width - thickness, 0, thickness, canvas.height],
    ];
    strips.forEach(([x, y, w, h]) => {
        gl.viewport(x, y, w, h);
        gl.drawArrays(gl.TRIANGLES, 0, quadObj.numVertices);
    });
    gl.viewport(0, 0, canvas.width, canvas.height);
}

function drawCube(vp, model, color, texture, useTexture, useBump, eye, light, ka, kd, ks, shininess) {
    gl.useProgram(program);
    const mvp = mat4Multiply(vp, model);
    gl.uniformMatrix4fv(program.u_MvpMatrix, false, mvp);
    gl.uniformMatrix4fv(program.u_modelMatrix, false, model);
    gl.uniform3f(program.u_LightPosition, light[0], light[1], light[2]);
    gl.uniform3f(program.u_ViewPosition, eye[0], eye[1], eye[2]);
    gl.uniform3f(program.u_Color, color[0], color[1], color[2]);
    gl.uniform1f(program.u_Ka, ka);
    gl.uniform1f(program.u_Kd, kd);
    gl.uniform1f(program.u_Ks, ks);
    gl.uniform1f(program.u_shininess, shininess);
    gl.uniform1i(program.u_useTexture, useTexture ? 1 : 0);
    gl.uniform1i(program.u_useBump, useBump ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(program.u_Sampler0, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, normalMapTex);
    gl.uniform1i(program.u_NormalMap, 1);
    bindCubeAttributes(program);
    gl.drawArrays(gl.TRIANGLES, 0, cubeObj.numVertices);
}

function drawObject(obj, vp, model, color, texture, useTexture, useBump, eye, light, ka, kd, ks, shininess) {
    const parts = obj && obj.length ? obj : [cubeObj];
    gl.useProgram(program);
    const mvp = mat4Multiply(vp, model);
    gl.uniformMatrix4fv(program.u_MvpMatrix, false, mvp);
    gl.uniformMatrix4fv(program.u_modelMatrix, false, model);
    gl.uniform3f(program.u_LightPosition, light[0], light[1], light[2]);
    gl.uniform3f(program.u_ViewPosition, eye[0], eye[1], eye[2]);
    gl.uniform3f(program.u_Color, color[0], color[1], color[2]);
    gl.uniform1f(program.u_Ka, ka);
    gl.uniform1f(program.u_Kd, kd);
    gl.uniform1f(program.u_Ks, ks);
    gl.uniform1f(program.u_shininess, shininess);
    gl.uniform1i(program.u_useTexture, useTexture ? 1 : 0);
    gl.uniform1i(program.u_useBump, useBump ? 1 : 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(program.u_Sampler0, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, normalMapTex);
    gl.uniform1i(program.u_NormalMap, 1);

    parts.forEach((part) => {
        initAttributeVariable(gl, program.a_Position, part.vertexBuffer);
        initAttributeVariable(gl, program.a_Normal, part.normalBuffer);
        initAttributeVariable(gl, program.a_TexCoord, part.texCoordBuffer);
        initAttributeVariable(gl, program.a_Tangent, part.tangentBuffer);
        gl.drawArrays(gl.TRIANGLES, 0, part.numVertices);
    });
}

function drawReflectiveCube(vp, model, tint, eye) {
    gl.useProgram(reflectProgram);
    gl.uniformMatrix4fv(reflectProgram.u_MvpMatrix, false, mat4Multiply(vp, model));
    gl.uniformMatrix4fv(reflectProgram.u_modelMatrix, false, model);
    gl.uniform3f(reflectProgram.u_ViewPosition, eye[0], eye[1], eye[2]);
    gl.uniform3f(reflectProgram.u_Tint, tint[0], tint[1], tint[2]);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, cubeMapTex);
    gl.uniform1i(reflectProgram.u_envCubeMap, 0);
    initAttributeVariable(gl, reflectProgram.a_Position, cubeObj.vertexBuffer);
    initAttributeVariable(gl, reflectProgram.a_Normal, cubeObj.normalBuffer);
    gl.drawArrays(gl.TRIANGLES, 0, cubeObj.numVertices);
}

function drawFlatCube(vp, model, color) {
    gl.useProgram(flatProgram);
    gl.uniformMatrix4fv(flatProgram.u_MvpMatrix, false, mat4Multiply(vp, model));
    gl.uniform4f(flatProgram.u_Color, color[0], color[1], color[2], color[3]);
    gl.uniform1i(flatProgram.u_useRing, 0);
    initAttributeVariable(gl, flatProgram.a_Position, cubeObj.vertexBuffer);
    gl.drawArrays(gl.TRIANGLES, 0, cubeObj.numVertices);
}

function drawFlatObject(obj, vp, model, color) {
    const parts = obj && obj.length ? obj : [cubeObj];
    gl.useProgram(flatProgram);
    gl.uniformMatrix4fv(flatProgram.u_MvpMatrix, false, mat4Multiply(vp, model));
    gl.uniform4f(flatProgram.u_Color, color[0], color[1], color[2], color[3]);
    gl.uniform1i(flatProgram.u_useRing, 0);
    parts.forEach((part) => {
        initAttributeVariable(gl, flatProgram.a_Position, part.vertexBuffer);
        gl.drawArrays(gl.TRIANGLES, 0, part.numVertices);
    });
}

function drawSkybox(viewDir, x, y, w, h, fov, aspect) {
    const projection = mat4Perspective(fov * Math.PI / 180, aspect, 0.1, 100);
    const view = mat4LookAt([0, 0, 0], viewDir, [0, 1, 0]);
    const vpInverse = mat4Invert(mat4Multiply(projection, view));
    gl.viewport(x, y, w, h);
    gl.depthFunc(gl.LEQUAL);
    gl.useProgram(skyboxProgram);
    gl.uniformMatrix4fv(skyboxProgram.u_viewDirectionProjectionInverse, false, vpInverse);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, cubeMapTex);
    gl.uniform1i(skyboxProgram.u_envCubeMap, 0);
    initAttributeVariable(gl, skyboxProgram.a_Position, quadObj.vertexBuffer);
    gl.drawArrays(gl.TRIANGLES, 0, quadObj.numVertices);
    gl.depthFunc(gl.LESS);
}

function getFirstPersonView() {
    const eye = [player.x, 0.72, player.z];
    const pitchCos = Math.cos(player.pitch);
    const dir = [
        Math.sin(player.yaw) * pitchCos,
        Math.sin(player.pitch),
        Math.cos(player.yaw) * pitchCos,
    ];
    const center = [eye[0] + dir[0], eye[1] + dir[1], eye[2] + dir[2]];
    const view = mat4LookAt(eye, center, [0, 1, 0]);
    const proj = mat4Perspective(65 * Math.PI / 180, canvas.width / canvas.height, 0.08, 80);
    return { vp: mat4Multiply(proj, view), eye, viewDir: dir };
}

function getMapView() {
    const eye = [0, 25, 0.001];
    const view = mat4LookAt(eye, [0, 0, 0], [0, 0, -1]);
    const proj = mat4Ortho(-15, 15, -13, 13, 0.1, 60);
    return { vp: mat4Multiply(proj, view), eye };
}

function moveEntity(entity, dx, dz) {
    if (!isBlocked(entity.x + dx, entity.z, entity.radius)) entity.x += dx;
    if (!isBlocked(entity.x, entity.z + dz, entity.radius)) entity.z += dz;
}

function isBlocked(x, z, radius) {
    const checks = [
        [x - radius, z - radius], [x + radius, z - radius],
        [x - radius, z + radius], [x + radius, z + radius],
    ];
    return checks.some(([px, pz]) => {
        const c = Math.round(px / cellSize + halfCols);
        const r = Math.round(pz / cellSize + halfRows);
        return r < 0 || c < 0 || r >= maze.length || c >= maze[0].length || maze[r][c] === "#";
    });
}

function worldFromCell(r, c) {
    return { x: (c - halfCols) * cellSize, z: (r - halfRows) * cellSize };
}

function cellFromWorld(x, z) {
    return {
        r: Math.max(0, Math.min(maze.length - 1, Math.round(z / cellSize + halfRows))),
        c: Math.max(0, Math.min(maze[0].length - 1, Math.round(x / cellSize + halfCols))),
    };
}

function distance2D(a, b) {
    return Math.hypot(a.x - b.x, a.z - b.z);
}

function mouseLook(ev) {
    if (gameState !== "playing") return;
    if (document.pointerLockElement !== canvas && ev.buttons !== 1) return;
    player.yaw -= ev.movementX * 0.0028;
    player.pitch = clamp(player.pitch - ev.movementY * 0.0024, -1.25, 1.25);
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function compileShader(gl, vShaderText, fShaderText) {
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(vertexShader, vShaderText);
    gl.shaderSource(fragmentShader, fShaderText);
    gl.compileShader(vertexShader);
    if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) console.log(gl.getShaderInfoLog(vertexShader));
    gl.compileShader(fragmentShader);
    if (!gl.getShaderParameter(fragmentShader, gl.COMPILE_STATUS)) console.log(gl.getShaderInfoLog(fragmentShader));
    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) alert(gl.getProgramInfoLog(program));
    return program;
}

function initAttributeVariable(gl, aAttribute, buffer) {
    if (aAttribute < 0 || !buffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.vertexAttribPointer(aAttribute, buffer.num, buffer.type, false, 0, 0);
    gl.enableVertexAttribArray(aAttribute);
}

function initArrayBufferForLaterUse(gl, data, num, type) {
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
    buffer.num = num;
    buffer.type = type;
    return buffer;
}

function initVertexBufferForLaterUse(gl, data) {
    const obj = {};
    obj.vertexBuffer = initArrayBufferForLaterUse(gl, data.positions, 3, gl.FLOAT);
    if (data.normals) obj.normalBuffer = initArrayBufferForLaterUse(gl, data.normals, 3, gl.FLOAT);
    if (data.texcoords) obj.texCoordBuffer = initArrayBufferForLaterUse(gl, data.texcoords, 2, gl.FLOAT);
    if (data.tangents) obj.tangentBuffer = initArrayBufferForLaterUse(gl, data.tangents, 3, gl.FLOAT);
    obj.numVertices = data.positions.length / 3;
    return obj;
}

async function loadOBJtoCreateVBO(objFile) {
    const response = await fetch(objFile);
    const text = await response.text();
    const obj = parseOBJ(text);
    return obj.geometries.map((geometry) => {
        const positions = geometry.data.position;
        const normals = geometry.data.normal && geometry.data.normal.length ? geometry.data.normal : makeDefaultNormals(positions);
        const texcoords = geometry.data.texcoord && geometry.data.texcoord.length ? geometry.data.texcoord : makeDefaultTexcoords(positions);
        const tangents = calculateTangents(positions, texcoords);
        return initVertexBufferForLaterUse(gl, { positions, normals, texcoords, tangents });
    });
}

function makeDefaultNormals(positions) {
    const normals = [];
    for (let i = 0; i < positions.length; i += 9) {
        const ax = positions[i + 3] - positions[i];
        const ay = positions[i + 4] - positions[i + 1];
        const az = positions[i + 5] - positions[i + 2];
        const bx = positions[i + 6] - positions[i];
        const by = positions[i + 7] - positions[i + 1];
        const bz = positions[i + 8] - positions[i + 2];
        let nx = ay * bz - az * by;
        let ny = az * bx - ax * bz;
        let nz = ax * by - ay * bx;
        const len = Math.hypot(nx, ny, nz) || 1;
        nx /= len; ny /= len; nz /= len;
        for (let j = 0; j < 3; j++) normals.push(nx, ny, nz);
    }
    return normals;
}

function makeDefaultTexcoords(positions) {
    const texcoords = [];
    for (let i = 0; i < positions.length / 3; i++) texcoords.push(0, 0);
    return texcoords;
}

function calculateTangents(positions, texcoords) {
    const tangents = [];
    for (let i = 0; i < positions.length; i += 9) {
        const x0 = positions[i], y0 = positions[i + 1], z0 = positions[i + 2];
        const x1 = positions[i + 3], y1 = positions[i + 4], z1 = positions[i + 5];
        const x2 = positions[i + 6], y2 = positions[i + 7], z2 = positions[i + 8];
        const uv = (i / 3) * 2;
        const u0 = texcoords[uv], v0 = texcoords[uv + 1];
        const u1 = texcoords[uv + 2], v1 = texcoords[uv + 3];
        const u2 = texcoords[uv + 4], v2 = texcoords[uv + 5];
        const du1 = u1 - u0, dv1 = v1 - v0;
        const du2 = u2 - u0, dv2 = v2 - v0;
        const denom = du1 * dv2 - dv1 * du2;
        let tx = 1, ty = 0, tz = 0;
        if (Math.abs(denom) > 0.00001) {
            const r = 1.0 / denom;
            tx = ((x1 - x0) * dv2 - (x2 - x0) * dv1) * r;
            ty = ((y1 - y0) * dv2 - (y2 - y0) * dv1) * r;
            tz = ((z1 - z0) * dv2 - (z2 - z0) * dv1) * r;
            const len = Math.hypot(tx, ty, tz) || 1;
            tx /= len; ty /= len; tz /= len;
        }
        for (let j = 0; j < 3; j++) tangents.push(tx, ty, tz);
    }
    return tangents;
}

function parseOBJ(text) {
    const objPositions = [[0, 0, 0]];
    const objTexcoords = [[0, 0]];
    const objNormals = [[0, 0, 1]];
    const objVertexData = [objPositions, objTexcoords, objNormals];
    let webglVertexData = [[], [], []];
    const geometries = [];
    let geometry;
    let groups = ["default"];
    let material = "default";
    let object = "default";

    function newGeometry() {
        if (geometry && geometry.data.position.length) geometry = undefined;
    }

    function setGeometry() {
        if (!geometry) {
            const position = [];
            const texcoord = [];
            const normal = [];
            webglVertexData = [position, texcoord, normal];
            geometry = { object, groups, material, data: { position, texcoord, normal } };
            geometries.push(geometry);
        }
    }

    function addVertex(vert) {
        const ptn = vert.split("/");
        ptn.forEach((objIndexStr, i) => {
            if (!objIndexStr) return;
            const objIndex = parseInt(objIndexStr, 10);
            const index = objIndex + (objIndex >= 0 ? 0 : objVertexData[i].length);
            webglVertexData[i].push(...objVertexData[i][index]);
        });
        if (ptn.length < 2 || !ptn[1]) webglVertexData[1].push(0, 0);
        if (ptn.length < 3 || !ptn[2]) webglVertexData[2].push(0, 0, 1);
    }

    const keywords = {
        v(parts) { objPositions.push(parts.map(parseFloat)); },
        vt(parts) { objTexcoords.push(parts.slice(0, 2).map(parseFloat)); },
        vn(parts) { objNormals.push(parts.map(parseFloat)); },
        f(parts) {
            setGeometry();
            for (let tri = 0; tri < parts.length - 2; tri++) {
                addVertex(parts[0]);
                addVertex(parts[tri + 1]);
                addVertex(parts[tri + 2]);
            }
        },
        usemtl(parts, unparsedArgs) { material = unparsedArgs; newGeometry(); },
        g(parts) { groups = parts; newGeometry(); },
        o(parts, unparsedArgs) { object = unparsedArgs; newGeometry(); },
        s() {},
        mtllib() {},
    };

    text.split("\n").forEach((line) => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) return;
        const m = /^(\w*)\s*(.*)$/.exec(trimmed);
        if (!m) return;
        const [, keyword, unparsedArgs] = m;
        const parts = trimmed.split(/\s+/).slice(1);
        const handler = keywords[keyword];
        if (handler) handler(parts, unparsedArgs);
    });

    geometries.forEach((g) => {
        g.data = Object.fromEntries(Object.entries(g.data).filter(([, array]) => array.length > 0));
    });
    return { geometries };
}

function bindCubeAttributes(p) {
    initAttributeVariable(gl, p.a_Position, cubeObj.vertexBuffer);
    initAttributeVariable(gl, p.a_Normal, cubeObj.normalBuffer);
    initAttributeVariable(gl, p.a_TexCoord, cubeObj.texCoordBuffer);
    initAttributeVariable(gl, p.a_Tangent, cubeObj.tangentBuffer);
}

function createCubeData() {
    const p = [], n = [], uv = [], t = [];
    const faces = [
        [[-1, -1, 1], [1, -1, 1], [-1, 1, 1], [1, 1, 1], [0, 0, 1], [1, 0, 0]],
        [[1, -1, -1], [-1, -1, -1], [1, 1, -1], [-1, 1, -1], [0, 0, -1], [-1, 0, 0]],
        [[1, -1, 1], [1, -1, -1], [1, 1, 1], [1, 1, -1], [1, 0, 0], [0, 0, -1]],
        [[-1, -1, -1], [-1, -1, 1], [-1, 1, -1], [-1, 1, 1], [-1, 0, 0], [0, 0, 1]],
        [[-1, 1, 1], [1, 1, 1], [-1, 1, -1], [1, 1, -1], [0, 1, 0], [1, 0, 0]],
        [[-1, -1, -1], [1, -1, -1], [-1, -1, 1], [1, -1, 1], [0, -1, 0], [1, 0, 0]],
    ];
    const order = [0, 1, 2, 2, 1, 3];
    const uvs = [[0, 0], [1, 0], [0, 1], [0, 1], [1, 0], [1, 1]];
    faces.forEach((f) => {
        order.forEach((idx, i) => {
            p.push(f[idx][0] * 0.5, f[idx][1] * 0.5, f[idx][2] * 0.5);
            n.push(f[4][0], f[4][1], f[4][2]);
            t.push(f[5][0], f[5][1], f[5][2]);
            uv.push(uvs[i][0], uvs[i][1]);
        });
    });
    return { positions: p, normals: n, texcoords: uv, tangents: t };
}

function createArrowData() {
    const y = 0;
    return {
        positions: [
            0.0, y, 0.78,
            0.46, y, 0.04,
            -0.46, y, 0.04,

            -0.18, y, 0.04,
            0.18, y, 0.04,
            -0.18, y, -0.58,

            -0.18, y, -0.58,
            0.18, y, 0.04,
            0.18, y, -0.58,
        ],
    };
}

function createCheckerTexture() {
    const size = 64;
    const data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const i = (y * size + x) * 4;
            const line = x % 16 < 2 || y % 16 < 2;
            const shade = line ? 185 : ((x >> 4) + (y >> 4)) % 2 ? 88 : 118;
            data[i] = shade; data[i + 1] = shade; data[i + 2] = shade + 18; data[i + 3] = 255;
        }
    }
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    return tex;
}

function createColorTexture(rgba) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(rgba));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    return tex;
}

function loadTexture2D(file, onload) {
    const img = new Image();
    img.onload = () => {
        const tex = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        onload(tex);
    };
    img.src = file;
}

function initCubeTexture(posXName, negXName, posYName, negYName, posZName, negZName) {
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
    const faces = [
        [gl.TEXTURE_CUBE_MAP_POSITIVE_X, posXName, false],
        [gl.TEXTURE_CUBE_MAP_NEGATIVE_X, negXName, false],
        [gl.TEXTURE_CUBE_MAP_POSITIVE_Y, posYName, false],
        [gl.TEXTURE_CUBE_MAP_NEGATIVE_Y, negYName, false],
        [gl.TEXTURE_CUBE_MAP_POSITIVE_Z, posZName, false],
        [gl.TEXTURE_CUBE_MAP_NEGATIVE_Z, negZName, false],
    ];
    faces.forEach(([target, name, flipY]) => {
        gl.texImage2D(target, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([8, 8, 14, 255]));
        const img = new Image();
        img.onload = () => {
            gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
            gl.texImage2D(target, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, flipY ? flipImageY(img) : img);
        };
        img.src = name;
    });
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
}

function flipImageY(img) {
    const offscreen = document.createElement("canvas");
    offscreen.width = img.width;
    offscreen.height = img.height;
    const ctx = offscreen.getContext("2d");
    ctx.translate(0, img.height);
    ctx.scale(1, -1);
    ctx.drawImage(img, 0, 0);
    return offscreen;
}

function modelMatrix(x, y, z, yaw, scale) {
    const m = new Matrix4();
    m.setTranslate(x, y, z);
    m.rotate(yaw * 180 / Math.PI, 0, 1, 0);
    m.scale(scale[0], scale[1], scale[2]);
    return m.elements;
}

function mat4Identity() {
    return new Matrix4().elements;
}

function mat4Multiply(a, b) {
    const out = new Matrix4({ elements: a });
    out.multiply(new Matrix4({ elements: b }));
    return out.elements;
}

function mat4Translate(x, y, z) {
    return new Matrix4().setTranslate(x, y, z).elements;
}

function mat4Scale(x, y, z) {
    return new Matrix4().setScale(x, y, z).elements;
}

function mat4RotateY(rad) {
    return new Matrix4().setRotate(rad * 180 / Math.PI, 0, 1, 0).elements;
}

function mat4Perspective(fovy, aspect, near, far) {
    return new Matrix4().setPerspective(fovy * 180 / Math.PI, aspect, near, far).elements;
}

function mat4Ortho(left, right, bottom, top, near, far) {
    return new Matrix4().setOrtho(left, right, bottom, top, near, far).elements;
}

function mat4LookAt(eye, center, up) {
    return new Matrix4().setLookAt(
        eye[0], eye[1], eye[2],
        center[0], center[1], center[2],
        up[0], up[1], up[2]
    ).elements;
}

function mat4Invert(a) {
    const out = new Matrix4({ elements: a });
    out.invert();
    return out.elements;
}

function resizeCanvasToDisplaySize() {
    const width = Math.floor(canvas.clientWidth * window.devicePixelRatio);
    const height = Math.floor(canvas.clientHeight * window.devicePixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
    }
}
