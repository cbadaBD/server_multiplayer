const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

/* ================================================= */
/* CONFIGURACIÓN */
/* ================================================= */

const TICK = 50;
const DT = TICK / 1000;

const WORLD = 60;

const PLAYER_SPEED = 8;

const BULLET_SPEED = 45;
const BULLET_LIFE = 1200;

const ZOMBIE_SPAWN_INTERVAL = 800;
const MAX_ZOMBIES = 80;

const RESPAWN_TIME = 3000;

/* ================================================= */
/* ESTADO */
/* ================================================= */

const players = new Map();
const zombies = new Map();
const bullets = new Map();

let zombieId = 1;
let bulletId = 1;

/* ================================================= */
/* UTILIDADES */
/* ================================================= */

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

function randomPosition() {
    return {
        x: (Math.random() * 2 - 1) * (WORLD - 5),
        z: (Math.random() * 2 - 1) * (WORLD - 5)
    };
}

/*
 * ==========================================================
 * CONVENCIÓN DE ÁNGULOS (MUY IMPORTANTE)
 * ==========================================================
 *
 * `angle` es el yaw de la cámara, EXACTAMENTE igual a
 * `camera.rotation.y` en three.js (orden de Euler 'YXZ').
 *
 * Con esa convención, la dirección "hacia donde mira la
 * cámara" (proyectada en el plano horizontal) es:
 *
 *   forward = (-sin(angle), -cos(angle))
 *
 * y el vector "a la derecha del jugador" es:
 *
 *   right   = ( cos(angle), -sin(angle))
 *
 * Estas dos funciones son la ÚNICA fuente de verdad para
 * cualquier cálculo de dirección (movimiento, disparo).
 * El cliente usa exactamente la misma convención al fijar
 * camera.rotation.y = angle, así que todo queda sincronizado
 * con lo que el jugador ve en pantalla.
 * ==========================================================
 */

function getForwardVector(angle) {
    return {
        x: -Math.sin(angle),
        z: -Math.cos(angle)
    };
}

function getRightVector(angle) {
    return {
        x: Math.cos(angle),
        z: -Math.sin(angle)
    };
}

/*
 * Dirección de disparo en 3D (yaw + pitch), consistente con
 * getForwardVector pero incluyendo el eje vertical.
 */
function getAimDirection(angle, pitch) {
    const cosPitch = Math.cos(pitch);
    return {
        x: -Math.sin(angle) * cosPitch,
        y: Math.sin(pitch),
        z: -Math.cos(angle) * cosPitch
    };
}

/* ================================================= */
/* SOCKET.IO */
/* ================================================= */

io.on('connection', function(socket) {

    console.log(
        'Conexión:',
        socket.id
    );

    /* ================================================= */
    /* JOIN */
    /* ================================================= */

    socket.on('join', function(data) {

        const name =
            String(
                data && data.name
                    ? data.name
                    : 'Jugador'
            ).slice(0, 16);

        const pos =
            randomPosition();

        players.set(socket.id, {

            id: socket.id,

            name: name,

            x: pos.x,
            y: 0,
            z: pos.z,

            /*
             * Yaw: igual a camera.rotation.y en el cliente.
             * 0 = mirar hacia -Z
             */
            angle: 0,

            /*
             * Pitch: igual a camera.rotation.x en el cliente.
             * 0 = horizontal
             * positivo = arriba
             * negativo = abajo
             */
            pitch: 0,

            health: 100,

            score: 0,

            kills: 0,

            alive: true,

            respawnAt: 0,

            forward: 0,

            right: 0

        });

        console.log(
            'Jugador unido:',
            name,
            socket.id
        );
    });

    /* ================================================= */
    /* INPUT */
    /* ================================================= */

    socket.on('input', function(data) {

        const player =
            players.get(socket.id);

        if (!player) {
            return;
        }

        if (!player.alive) {
            return;
        }

        const forward =
            Number(
                data && data.f
            );

        const right =
            Number(
                data && data.r
            );

        const angle =
            Number(
                data && data.a
            );

        const pitch =
            Number(
                data && data.p
            );

        player.forward =
            clamp(
                Number.isFinite(forward)
                    ? forward
                    : 0,
                -1,
                1
            );

        player.right =
            clamp(
                Number.isFinite(right)
                    ? right
                    : 0,
                -1,
                1
            );

        if (
            Number.isFinite(angle)
        ) {

            player.angle =
                angle;
        }

        if (
            Number.isFinite(pitch)
        ) {

            player.pitch =
                clamp(
                    pitch,
                    -1.35,
                    1.35
                );
        }

    });

    /* ================================================= */
    /* DISPARO */
    /* ================================================= */

    socket.on('shoot', function() {

        const player =
            players.get(socket.id);

        if (!player) {
            return;
        }

        if (!player.alive) {
            return;
        }

        /*
         * Dirección EXACTA de la cámara (misma convención
         * que el cliente ve en pantalla).
         */

        const dir =
            getAimDirection(
                player.angle,
                player.pitch
            );

        /*
         * Posición inicial de la bala.
         *
         * Altura aproximada de los ojos.
         */

        const startX =
            player.x +
            dir.x * 0.8;

        const startY =
            1.65 +
            dir.y * 0.8;

        const startZ =
            player.z +
            dir.z * 0.8;

        const id =
            String(
                bulletId++
            );

        bullets.set(
            id,
            {

                id: id,

                owner:
                    socket.id,

                x: startX,

                y: startY,

                z: startZ,

                vx:
                    dir.x *
                    BULLET_SPEED,

                vy:
                    dir.y *
                    BULLET_SPEED,

                vz:
                    dir.z *
                    BULLET_SPEED,

                born:
                    Date.now()

            }
        );

    });

    /* ================================================= */
    /* CHAT */
    /* ================================================= */

    socket.on('chat', function(text) {

        const player =
            players.get(socket.id);

        if (!player) {
            return;
        }

        const message =
            String(
                text || ''
            )
            .trim()
            .slice(0, 100);

        if (!message) {
            return;
        }

        io.emit(
            'chat',
            {
                name:
                    player.name,

                text:
                    message
            }
        );

    });

    /* ================================================= */
    /* DISCONNECT */
    /* ================================================= */

    socket.on(
        'disconnect',
        function() {

            console.log(
                'Desconectado:',
                socket.id
            );

            players.delete(
                socket.id
            );
        }
    );

});

/* ================================================= */
/* ZOMBIES */
/* ================================================= */

function spawnZombie() {

    if (
        zombies.size >=
        MAX_ZOMBIES
    ) {

        return;
    }

    const pos =
        randomPosition();

    let type =
        'normal';

    const roll =
        Math.random();

    if (
        roll < 0.10
    ) {

        type =
            'tank';

    } else if (
        roll < 0.30
    ) {

        type =
            'runner';
    }

    let health =
        50;

    let speed =
        2.0;

    if (
        type === 'tank'
    ) {

        health =
            180;

        speed =
            1.2;

    } else if (
        type === 'runner'
    ) {

        health =
            35;

        speed =
            3.8;
    }

    const id =
        String(
            zombieId++
        );

    zombies.set(
        id,
        {

            id: id,

            type:
                type,

            x:
                pos.x,

            y:
                0,

            z:
                pos.z,

            health:
                health,

            speed:
                speed

        }
    );
}

/* ================================================= */
/* JUGADOR MÁS CERCANO */
/* ================================================= */

function getNearestPlayer(
    zombie
) {

    let nearest =
        null;

    let nearestDistance =
        Infinity;

    for (
        const player
        of players.values()
    ) {

        if (
            !player.alive
        ) {

            continue;
        }

        const dx =
            player.x -
            zombie.x;

        const dz =
            player.z -
            zombie.z;

        const distance =
            Math.sqrt(
                dx * dx +
                dz * dz
            );

        if (
            distance <
            nearestDistance
        ) {

            nearestDistance =
                distance;

            nearest =
                player;
        }
    }

    return nearest;
}

/* ================================================= */
/* LOOP DEL JUEGO */
/* ================================================= */

let lastZombieSpawn =
    Date.now();

setInterval(
    function() {

        const now =
            Date.now();

        /* ============================================= */
        /* JUGADORES */
        /* ============================================= */

        for (
            const player
            of players.values()
        ) {

            /*
             * Respawn.
             */

            if (
                !player.alive
            ) {

                if (
                    now >=
                    player.respawnAt
                ) {

                    const pos =
                        randomPosition();

                    player.x =
                        pos.x;

                    player.y =
                        0;

                    player.z =
                        pos.z;

                    player.health =
                        100;

                    player.alive =
                        true;

                    player.forward =
                        0;

                    player.right =
                        0;
                }

                continue;
            }

            /* ========================================= */
            /* DIRECCIÓN DE MOVIMIENTO */
            /*                                           */
            /* Usa EXACTAMENTE la misma convención de     */
            /* ángulos que la cámara del cliente, por     */
            /* eso los vectores salen de las funciones     */
            /* compartidas de arriba.                      */
            /* ========================================= */

            const forwardVec =
                getForwardVector(
                    player.angle
                );

            const rightVec =
                getRightVector(
                    player.angle
                );

            /* ========================================= */
            /* MOVIMIENTO */
            /* ========================================= */

            let moveX =
                forwardVec.x *
                player.forward;

            moveX +=
                rightVec.x *
                player.right;

            let moveZ =
                forwardVec.z *
                player.forward;

            moveZ +=
                rightVec.z *
                player.right;

            /*
             * Evitar que W+D sea más rápido.
             */

            const length =
                Math.sqrt(
                    moveX * moveX +
                    moveZ * moveZ
                );

            if (
                length > 1
            ) {

                moveX /=
                    length;

                moveZ /=
                    length;
            }

            player.x +=
                moveX *
                PLAYER_SPEED *
                DT;

            player.z +=
                moveZ *
                PLAYER_SPEED *
                DT;

            /*
             * Límites.
             */

            player.x =
                clamp(
                    player.x,
                    -WORLD,
                    WORLD
                );

            player.z =
                clamp(
                    player.z,
                    -WORLD,
                    WORLD
                );
        }

        /* ============================================= */
        /* ZOMBIES */
        /* ============================================= */

        for (
            const zombie
            of zombies.values()
        ) {

            const target =
                getNearestPlayer(
                    zombie
                );

            if (!target) {
                continue;
            }

            const dx =
                target.x -
                zombie.x;

            const dz =
                target.z -
                zombie.z;

            const distance =
                Math.sqrt(
                    dx * dx +
                    dz * dz
                );

            if (
                distance > 1.5
            ) {

                zombie.x +=
                    (
                        dx /
                        distance
                    ) *
                    zombie.speed *
                    DT;

                zombie.z +=
                    (
                        dz /
                        distance
                    ) *
                    zombie.speed *
                    DT;

            } else {

                target.health -=
                    10 *
                    DT;

                if (
                    target.health <= 0
                ) {

                    target.health =
                        0;

                    target.alive =
                        false;

                    target.respawnAt =
                        now +
                        RESPAWN_TIME;
                }
            }
        }

        /* ============================================= */
        /* BALAS */
        /* ============================================= */

        for (
            const [id, bullet]
            of bullets
        ) {

            bullet.x +=
                bullet.vx *
                DT;

            bullet.y +=
                bullet.vy *
                DT;

            bullet.z +=
                bullet.vz *
                DT;

            /*
             * Vida de la bala.
             */

            if (
                now -
                bullet.born >
                BULLET_LIFE
            ) {

                bullets.delete(
                    id
                );

                continue;
            }

            /*
             * Fuera del mapa.
             */

            if (
                Math.abs(
                    bullet.x
                ) >
                WORLD + 10 ||

                Math.abs(
                    bullet.z
                ) >
                WORLD + 10 ||

                bullet.y < -5 ||

                bullet.y > 30
            ) {

                bullets.delete(
                    id
                );

                continue;
            }

            /* ========================================= */
            /* COLISIÓN CON ZOMBIES */
            /* ========================================= */

            let hit =
                false;

            for (
                const [
                    zombieIdValue,
                    zombie
                ]
                of zombies
            ) {

                const dx =
                    bullet.x -
                    zombie.x;

                const dy =
                    bullet.y -
                    1.0;

                const dz =
                    bullet.z -
                    zombie.z;

                const distance =
                    Math.sqrt(
                        dx * dx +
                        dy * dy +
                        dz * dz
                    );

                const hitRadius =
                    zombie.type === 'tank'
                        ? 1.1
                        : 0.75;

                if (
                    distance <
                    hitRadius
                ) {

                    zombie.health -=
                        25;

                    hit =
                        true;

                    const owner =
                        players.get(
                            bullet.owner
                        );

                    if (
                        zombie.health <=
                        0
                    ) {

                        if (owner) {

                            owner.score +=
                                zombie.type === 'tank'
                                    ? 3
                                    : 1;

                            owner.kills +=
                                1;
                        }

                        zombies.delete(
                            zombieIdValue
                        );
                    }

                    break;
                }
            }

            if (hit) {

                bullets.delete(
                    id
                );

                continue;
            }
        }

        /* ============================================= */
        /* SPAWN */
        /* ============================================= */

        if (
            now -
            lastZombieSpawn >=
            ZOMBIE_SPAWN_INTERVAL
        ) {

            lastZombieSpawn =
                now;

            spawnZombie();
            spawnZombie();
            spawnZombie();
        }

    },
    TICK
);

/* ================================================= */
/* ENVIAR ESTADO */
/* ================================================= */

setInterval(
    function() {

        const playerList =
            [];

        for (
            const player
            of players.values()
        ) {

            playerList.push(
                {

                    i:
                        player.id,

                    n:
                        player.name,

                    x:
                        player.x,

                    z:
                        player.z,

                    r:
                        player.angle,

                    h:
                        player.health,

                    s:
                        player.score,

                    k:
                        player.kills,

                    a:
                        player.alive
                }
            );
        }

        const zombieList =
            [];

        for (
            const zombie
            of zombies.values()
        ) {

            zombieList.push(
                {

                    i:
                        zombie.id,

                    x:
                        zombie.x,

                    z:
                        zombie.z,

                    t:
                        zombie.type,

                    h:
                        zombie.health
                }
            );
        }

        const bulletList =
            [];

        for (
            const bullet
            of bullets.values()
        ) {

            bulletList.push(
                {

                    i:
                        bullet.id,

                    x:
                        bullet.x,

                    y:
                        bullet.y,

                    z:
                        bullet.z
                }
            );
        }

        for (
            const [
                id,
                player
            ]
            of players
        ) {

            io.to(id).emit(
                's',
                {

                    me:
                        {

                            x:
                                player.x,

                            z:
                                player.z,

                            h:
                                player.health,

                            s:
                                player.score,

                            k:
                                player.kills,

                            a:
                                player.alive

                        },

                    n:
                        players.size,

                    p:
                        playerList,

                    z:
                        zombieList,

                    b:
                        bulletList

                }
            );
        }

    },
    TICK
);

/* ================================================= */
/* SERVIDOR HTTP */
/* ================================================= */

server.listen(
    PORT,
    HOST,
    function() {

        console.log(
            '================================'
        );

        console.log(
            ' L4D 3D SERVER'
        );

        console.log(
            '================================'
        );

        console.log(
            'Servidor en http://' +
            HOST +
            ':' +
            PORT
        );

        console.log(
            'Puerto:',
            PORT
        );

        console.log(
            'Host:',
            HOST
        );

    }
);
