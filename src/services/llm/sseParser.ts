export interface SSEEvent {
  event: string;
  data: string;
  id?: string;
}

/**
 * Incremental Server-Sent Events parser safe against arbitrary TCP/UTF-8 chunk splits.
 */
export class SSEParser {
  private buffer = '';
  private pendingCR = false;
  private started = false;
  private currentEvent = 'message';
  private currentId: string | undefined;
  private dataLines: string[] = [];

  feed(chunk: string): SSEEvent[] {
    if (!chunk) return [];
    let normalized = chunk;
    if (!this.started) {
      this.started = true;
      if (normalized.charCodeAt(0) === 0xfeff) {
        normalized = normalized.slice(1);
        if (!normalized) return [];
      }
    }
    if (this.pendingCR) {
      this.pendingCR = false;
      if (normalized.startsWith('\n')) {
        normalized = normalized.slice(1);
      }
    }
    if (normalized.endsWith('\r')) {
      this.pendingCR = true;
    }
    if (normalized.indexOf('\r') !== -1) {
      normalized = normalized.replace(/\r\n?/g, '\n');
    }
    this.buffer += normalized;

    const events: SSEEvent[] = [];
    let start = 0;
    let newlineIndex = this.buffer.indexOf('\n', start);

    while (newlineIndex !== -1) {
      const line = this.buffer.slice(start, newlineIndex);
      start = newlineIndex + 1;
      const evt = this.processLine(line);
      if (evt) events.push(evt);
      newlineIndex = this.buffer.indexOf('\n', start);
    }

    if (start > 0) {
      this.buffer = start >= this.buffer.length ? '' : this.buffer.slice(start);
    }

    return events;
  }

  flush(): SSEEvent[] {
    const events: SSEEvent[] = [];
    if (this.buffer.length > 0) {
      const evt = this.processLine(this.buffer);
      if (evt) events.push(evt);
      this.buffer = '';
    }
    const tail = this.dispatchEvent();
    if (tail) events.push(tail);
    return events;
  }

  private processLine(line: string): SSEEvent | null {
    if (line === '') {
      return this.dispatchEvent();
    }
    if (line.startsWith(':')) {
      return null;
    }

    const colonIdx = line.indexOf(':');
    const field = colonIdx === -1 ? line : line.slice(0, colonIdx);
    let value = colonIdx === -1 ? '' : line.slice(colonIdx + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    switch (field) {
      case 'event':
        this.currentEvent = value || 'message';
        break;
      case 'data':
        this.dataLines.push(value);
        break;
      case 'id':
        this.currentId = value;
        break;
      default:
        break;
    }
    return null;
  }

  private dispatchEvent(): SSEEvent | null {
    if (this.dataLines.length === 0) {
      this.currentEvent = 'message';
      this.currentId = undefined;
      return null;
    }
    const data =
      this.dataLines.length === 1 ? this.dataLines[0] : this.dataLines.join('\n');
    const event: SSEEvent = {
      event: this.currentEvent || 'message',
      data,
      ...(this.currentId !== undefined ? { id: this.currentId } : {}),
    };
    this.currentEvent = 'message';
    this.currentId = undefined;
    this.dataLines.length = 0;
    return event;
  }
}
