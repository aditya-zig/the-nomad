import { TextCell, el } from './dom';
import type { NomadState } from '../logic/nomad';

/** Compact, change-detected expedition ledger; no new event listeners or animation loops. */
export class NomadView {
  private readonly root: HTMLElement;
  private readonly stores: TextCell;
  private readonly ember: TextCell;
  private readonly iron: TextCell;
  private readonly status: TextCell;

  constructor(parent: HTMLElement) {
    this.root = el('section', 'nomad-stores', parent);
    this.root.setAttribute('aria-label', 'Expedition supplies and clan trust');
    this.stores = new TextCell(el('div', 'nomad-stock', this.root));
    const clans = el('div', 'nomad-clans', this.root);
    this.ember = new TextCell(el('span', '', clans));
    this.iron = new TextCell(el('span', '', clans));
    this.status = new TextCell(el('div', 'nomad-hint', this.root));
  }

  update(n?: NomadState): void {
    this.root.hidden = !n;
    if (!n) return;
    this.stores.set(`${n.cells} cells · Water ${Math.ceil(n.water)}% · Food ${Math.ceil(n.food)}%`);
    this.ember.set(`Ember ${n.trust.ember}/100`);
    this.iron.set(`Iron ${n.trust.iron}/100`);
    this.status.set(n.cargoLoaded ? 'Convoy cargo secured' : Math.max(n.trust.ember, n.trust.iron) >= 60
      ? 'Clan alliance secured · Bring 3 cells home'
      : 'Trading posts: share [7] Ember / [8] Iron');
    this.root.dataset.low = String(n.water < 25 || n.food < 25);
  }
}
