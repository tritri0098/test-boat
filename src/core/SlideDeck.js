export class SlideDeck {
  constructor({ world, scenes=[] }) {
    this.world = world;
    this.scenes = scenes;
    this.index = 0;
    this.onChange = null;
  }

  addScene(scene) { this.scenes.push(scene); return this; }

  async goTo(ref) {
    const index = typeof ref === 'number' ? ref : this.scenes.findIndex(s=>s.id===ref);
    if (index < 0 || index >= this.scenes.length) return;
    const scene = this.scenes[index];
    this.index = index;
    await this.world.applyScene(scene);
    this.onChange?.(scene,index);
  }

  next() { return this.goTo((this.index+1)%this.scenes.length); }
  prev() { return this.goTo((this.index-1+this.scenes.length)%this.scenes.length); }
}
