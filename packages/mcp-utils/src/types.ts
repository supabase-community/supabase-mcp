export interface DuplexStream<T> {
  readable: ReadableStream<T>;
  writable: WritableStream<T>;
}
