export interface Repository<T> {
  list(): Promise<T[]>;
}
