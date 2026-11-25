import { EventEmitter } from 'node:events';

export const MAX_LINE_LENGTH = 1024 * 1024; // 1 MB

export class RpcStream extends EventEmitter {
  constructor(stream) {
    super();
    this.stream = stream;
    this.buffer = '';
    
    if (this.stream) {
      this.stream.setEncoding('utf8');
      this.stream.on('data', (chunk) => this._onData(chunk));
      this.stream.on('end', () => this.emit('end'));
      this.stream.on('error', (err) => this.emit('error', err));
    }
  }

  _onData(chunk) {
    this.buffer += chunk;
    
    let newlineIndex;
    while ((newlineIndex = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);
      
      if (line.length > MAX_LINE_LENGTH) {
        this.emit('error', new Error('Message exceeded 1 MB limit'));
        this.stream.destroy();
        return;
      }

      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const msg = JSON.parse(trimmed);
        this.emit('message', msg);
      } catch (err) {
        // Just emit error but keep processing? Usually protocol error kills connection.
        this.emit('error', new Error('Failed to parse JSON-RPC message: ' + err.message));
        this.stream.destroy();
        return;
      }
    }

    if (this.buffer.length > MAX_LINE_LENGTH) {
      this.emit('error', new Error('Message exceeded 1 MB limit'));
      this.stream.destroy();
      return;
    }
  }

  send(msg) {
    const serialized = JSON.stringify(msg);
    if (serialized.length > MAX_LINE_LENGTH) {
      throw new Error('Message to send exceeded 1 MB limit');
    }
    if (this.stream && this.stream.writable) {
      this.stream.write(serialized + '\n');
    }
  }
}
