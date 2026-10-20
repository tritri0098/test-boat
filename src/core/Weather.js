import { gsap } from 'gsap';

export class Weather {
  constructor() {
    this.state = { storm:0, rain:0, wind:3, cloud:0.12 };
    this.tween = null;
  }

  transitionTo(target, duration=3.8) {
    this.tween?.kill();
    this.tween = gsap.to(this.state, { ...target, duration, ease:'power2.inOut' });
    return this.tween;
  }
}
