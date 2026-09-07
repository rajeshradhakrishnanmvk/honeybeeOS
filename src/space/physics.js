const MU_EARTH = 3.986004418e14; // m^3/s^2
const EARTH_RADIUS = 6_371_000; // m

function magnitude(vector) {
  const { x = 0, y = 0, z = 0 } = vector || {};
  return Math.hypot(x, y, z);
}

function scale(vector, factor) {
  return {
    x: vector.x * factor,
    y: vector.y * factor,
    z: vector.z * factor
  };
}

function add(a, b) {
  return {
    x: a.x + b.x,
    y: a.y + b.y,
    z: a.z + b.z
  };
}

export function propagateOrbitStep(state, dtSeconds) {
  const dt = Math.max(0, Number(dtSeconds) || 0);
  const position = { ...state.position };
  const velocity = { ...state.velocity };

  const radius = magnitude(position);
  if (radius === 0 || dt === 0) return { ...state, position, velocity };

  const acceleration = scale(position, -MU_EARTH / (radius * radius * radius));
  const newVelocity = add(velocity, scale(acceleration, dt));
  const newPosition = add(position, scale(newVelocity, dt));

  return {
    ...state,
    time: (state.time || 0) + dt,
    position: newPosition,
    velocity: newVelocity
  };
}

export function telemetryFromState(state) {
  const radius = magnitude(state.position);
  const altitude = Math.max(0, radius - EARTH_RADIUS);
  const velocity = magnitude(state.velocity);

  return {
    altitude,
    velocity,
    fuel: state.fuel,
    battery: state.battery,
    time: state.time || 0
  };
}

export { MU_EARTH, EARTH_RADIUS };
