import type { CustomContext } from './types.js';

export type RouteResult<T = unknown> = Promise<T | null | undefined> | T | null | undefined;

export type RouteParams = Readonly<Record<string, string | undefined>>;

export type RouteContext<R = unknown, C extends CustomContext = CustomContext> = Readonly<{
  context?: C | null;
  router: Router<R, C>;
  route: Route<R, C>;
  parent: Route<R, C> | null;
  path: URL | string;
  params: RouteParams;
  next(): RouteResult<R> | undefined;
}>;

export type Route<R = unknown, C extends CustomContext = CustomContext> = Readonly<{
  children?: ReadonlyArray<Route<R, C>> | null;
  path: string;
  action?(context: RouteContext<R, C>): RouteResult<R>;
}>;

export type RouterErrorHandler<R = unknown, C extends CustomContext = CustomContext> = (
  path: URL | string,
  error: RouterError,
  context?: C | null,
) => RouteResult<R>;

export type RouterOptions<R = unknown> = Readonly<{
  baseURL: URL | string;
  errorHandler?: RouterErrorHandler<R>;
}>;

export class RouterError extends Error {
  readonly status: number;

  constructor(status: number, message?: string, options?: ErrorOptions) {
    super(message, options);
    this.status = status;
  }
}

const urlJoinersPattern = /^\/*(.*?)\/*$/u;
function stripJoiners(path: string): string {
  const [, part] = urlJoinersPattern.exec(path) ?? [];
  return part;
}

export default class Router<R = unknown, C extends CustomContext = CustomContext> {
  readonly #routes: ReadonlyArray<Route<R, C>>;
  readonly #patterns = new WeakMap<Route<R, C>, URLPattern>();
  readonly #options?: RouterOptions<R>;

  constructor(routes: ReadonlyArray<Route<R, C>> | Route<R, C>, options?: RouterOptions<R>) {
    this.#routes = Array.isArray(routes) ? (routes as ReadonlyArray<Route<R, C>>) : [routes as Route<R, C>];
    this.#options = options;
    this.#patternize(this.#routes, [stripJoiners(String(options?.baseURL ?? location.origin))]);
  }

  async resolve(path: URL | string, context?: C | null): Promise<RouteResult<R>> {
    try {
      return await this.#resolve(path, this.#routes, null, context);
    } catch (e: unknown) {
      if (e instanceof RouterError && this.#options?.errorHandler) {
        return this.#options.errorHandler(path, e, context);
      }

      throw e;
    }
  }

  #patternize(routes: ReadonlyArray<Route<R, C>>, parents: readonly string[] = []): void {
    for (const route of routes) {
      const base = parents.join('/');
      const path = stripJoiners(route.path);
      this.#patterns.set(route, new URLPattern(path, base));

      if (route.children?.length) {
        this.#patternize(route.children, [...parents, path]);
      }
    }
  }

  async #resolve(
    path: URL | string,
    routes: ReadonlyArray<Route<R, C>>,
    parent: Route<R, C> | null,
    context: C | null | undefined,
  ): Promise<RouteResult<R>> {
    for (const route of routes) {
      // There cannot be a router without appropriate pattern, so we can safely suppress null
      const result = this.#patterns.get(route)!.exec(path);

      if (result) {
        const next = async () => (route.children ? this.#resolve(path, route.children, route, context) : undefined);

        return (
          route.action?.({
            context,
            next,
            params: result.search.groups,
            parent,
            path,
            route,
            router: this,
          }) ?? next()
        );
      }
    }

    throw new RouterError(404, `Page ${String(path)} is not found`);
  }
}
