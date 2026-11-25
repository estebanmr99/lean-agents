const VETO_WORDS = /delete|remove|rm|drop|kill|exec|execute|shell|write|move|rename|create|update|edit|replace|insert|send|post|push|upload|install|apply|set|patch|commit|run|fetch/i;

export class Policy {
  constructor(config) {
    this.allow = new Set(config.allow || []);
    this.budget = Math.min(config.sessionBudget || 500, 2000);
    this.calls = 0;
    
    // Server -> Tool -> readOnlyHint
    this.readOnlyHints = new Map();
  }

  setTools(server, toolsList) {
    let map = this.readOnlyHints.get(server);
    if (!map) {
      map = new Map();
      this.readOnlyHints.set(server, map);
    }
    for (const t of toolsList) {
      map.set(t.name, Boolean(t.readOnlyHint));
    }
  }

  isBlocked(server, toolName) {
    const fullName = `${server}.${toolName}`;
    
    // Explicit allowlist overrides veto
    if (this.allow.has(fullName)) return false;
    
    // Veto blocks readOnlyHint
    if (VETO_WORDS.test(toolName)) return true;
    
    // If readOnlyHint is true, it's allowed
    if (this.readOnlyHints.get(server)?.get(toolName)) return false;
    
    // Default deny
    return true;
  }

  checkBudget() {
    if (this.calls >= this.budget) {
      throw new Error(`Session budget exceeded (${this.budget} calls)`);
    }
    this.calls++;
  }
}
