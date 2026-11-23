// Configuración inicial de Matter.js
const { Engine, Render, Runner, Bodies, Composite, Constraint, Body, Events } = Matter;

const engine = Engine.create();
const render = Render.create({
    element: document.getElementById('game-container'),
    engine: engine,
    options: {
        width: 600,
        height: 800,
        wireframes: false,
        background: '#111'
    }
});

// Paredes de la mesa
const wallOptions = { isStatic: true, render: { fillStyle: '#444' } };
const walls = [
    Bodies.rectangle(300, 0, 600, 20, wallOptions),    // Techo
    Bodies.rectangle(0, 400, 20, 800, wallOptions),    // Izquierda
    Bodies.rectangle(600, 400, 20, 800, wallOptions),  // Derecha
    Bodies.rectangle(500, 400, 20, 800, wallOptions),  // Pared canal lanzamiento
    Bodies.rectangle(300, 800, 600, 20, wallOptions)   // Suelo
];
Composite.add(engine.world, walls);

// Bola
const ball = Bodies.circle(550, 750, 10, { restitution: 0.8 });
Composite.add(engine.world, ball);

// Flippers
const flipperLeft = Bodies.rectangle(230, 700, 100, 20, { 
    isStatic: false, angle: 0.5, render: { fillStyle: '#f00' } 
});
const flipperRight = Bodies.rectangle(370, 700, 100, 20, { 
    isStatic: false, angle: -0.5, render: { fillStyle: '#f00' } 
});

Composite.add(engine.world, [
    Constraint.create({ pointA: { x: 200, y: 700 }, bodyB: flipperLeft, pointB: { x: -40, y: 0 } }),
    Constraint.create({ pointA: { x: 400, y: 700 }, bodyB: flipperRight, pointB: { x: 40, y: 0 } }),
    flipperLeft, flipperRight
]);

// Lanzador (Plunger) - bloque sólido con restricción estricta
const plunger = Bodies.rectangle(550, 790, 40, 20, { 
    isStatic: false,
    render: { fillStyle: '#0f0' }
});

// Restricción para que NO se pierda de la pantalla
const plungerConstraint = Constraint.create({
    pointA: { x: 550, y: 790 },
    bodyB: plunger,
    pointB: { x: 0, y: 0 },
    stiffness: 0.8,
    length: 0
});
Composite.add(engine.world, [plunger, plungerConstraint]);

// Controles
document.addEventListener('keydown', (e) => {
    if (e.code === 'ArrowLeft' || e.key === 'a') Body.setAngularVelocity(flipperLeft, -0.4);
    if (e.code === 'ArrowRight' || e.key === 'd') Body.setAngularVelocity(flipperRight, 0.4);
    if (e.code === 'Space') {
        // Empuje vertical aplicado directamente
        Body.applyForce(plunger, plunger.position, { x: 0, y: -0.5 });
    }
});

// Sensor de reinicio (zona inferior)
const sensor = Bodies.rectangle(250, 790, 500, 10, { isSensor: true, isStatic: true });
Events.on(engine, 'collisionStart', (event) => {
    event.pairs.forEach((pair) => {
        if (pair.bodyA === sensor || pair.bodyB === sensor) {
            Body.setPosition(ball, { x: 550, y: 750 });
            Body.setVelocity(ball, { x: 0, y: 0 });
        }
    });
});
Composite.add(engine.world, sensor);

Render.run(render);
Runner.run(Runner.create(), engine);
