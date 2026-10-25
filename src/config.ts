/** Tunable settings for the simulator (units: metres, seconds). */
export const FOV_DEGREES = 70; // horizontal field of view

/** W = nose down (push the stick forward), S = nose up. Set true if you prefer W = climb. */
export const INVERT_PITCH = false;

export const STALL_SPEED = 25.0;
export const MAX_SPEED = 100.0; // level-flight speed at full throttle
export const MIN_SPEED = 30.0; // level-flight speed at idle throttle
export const DRAG = 0.0005; // deceleration per speed^2
export const IDLE_THRUST = DRAG * MIN_SPEED ** 2; // chosen so the speeds above hold in level flight
export const MAX_THRUST = DRAG * MAX_SPEED ** 2;
export const GEAR_DRAG = 0.25; // extra drag fraction with the gear fully down
export const GEAR_TIME = 2.0; // seconds for the gear to move up / down
export const MAX_GROUND_SPEED = 300 / 3.6; // 300 km/h, in m/s
export const WING_LOSS_ROLL = 1.0; // rad/s the plane rolls toward the side whose wing is missing
export const WING_LOSS_AILERON = 0.5; // aileron effectiveness left with a wing missing
export const WING_LOSS_SINK = 3.0; // m/s of extra sink from the lift lost with a wing
export const GROUND_FRICTION = 0.5; // m/s^2 rolling resistance on the ground
export const WHEEL_BRAKE = 8.0; // m/s^2 extra deceleration from the brake key on the ground
export const TAXI_TURN_RATE = 0.6; // rad/s nose-wheel steering
export const BRAKE_DRAG = 6.0; // air brake multiplies drag by (1 + this)
export const BRAKE_RATE = 2.0; // how fast the air brake deploys / retracts (1/s)
export const INDUCED_DRAG = 2.0; // extra deceleration when pulling g in a steep bank
export const PITCH_RATE = 0.8; // rad/s at full elevator
export const ROLL_RATE = 1.6; // rad/s at full aileron
export const CONTROL_LAG = 5.0; // how quickly control surfaces follow the keys (1/s)
export const CONTROL_SPEED = 55.0; // speed at which controls reach full authority
export const BANK_NOSE_DROP = 0.4; // rad/s of nose drop per unit of (1 - cos(bank))
export const TURN_FACTOR = 2.0; // >1 makes turns tighter than physically exact
export const MAX_TURN_RATE = 0.9; // rad/s
export const THROTTLE_RATE = 0.4; // per second
export const MAX_PITCH = 1.3; // rad (~75 degrees)
export const MAX_ROLL = 1.35; // rad (~77 degrees)

export const START_POSITION = [0.0, 140.0, -900.0] as const;

/** Landing limits (the landing speed itself is per aircraft). */
export const LAND_MAX_ATTITUDE = 0.2; // rad of pitch / roll
export const LAND_MAX_SINK = 6.0; // m/s

export const FOG_START = 1400.0;
export const FOG_END = 3600.0;
