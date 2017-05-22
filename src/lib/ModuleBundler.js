import Promise from 'bluebird';
import path, { sep } from 'path';
import resolvePackage from 'resolve-pkg';
import { walker, handleFile } from './utils';

/**
 *  @class ModuleBundler
 *
 *  Handles the inclusion of node_modules.
 */
export default class ModuleBundler {
  constructor(config = {}, artifact) {
    this.config = {
      servicePath: '',  // serverless.config.servicePath
      zip: null,        // Yazl zip config
      ...config,
    };

    this.log = this.config.log || (() => { });

    this.artifact = artifact;
  }

  /**
   *  Determines module locations then adds them into ./node_modules
   *  inside the artifact.
   */
  async bundle({ include = [], exclude = [], deepExclude = [] }) {
    this.modules = await this._resolveDependencies(
      this.config.servicePath,
      { include, exclude, deepExclude },
    );

    await Promise.map(this.modules, async ({ packagePath, relativePath }) => {
      const onFile = async (basePath, stats, next) => {
        const relPath = path.join(
          relativePath, basePath.split(relativePath)[1], stats.name
        ).replace(/^\/|\/$/g, '');

        const filePath = path.join(basePath, stats.name);

        await handleFile({
          filePath,
          relPath,
          transforms: [],
          transformExtensions: ['js', 'jsx'],
          useSourceMaps: false,
          artifact: this.artifact,
          zipConfig: this.config.zip,
        });

        next();
      };

      await walker(packagePath)
        .on('file', onFile)
        .end();
    });

    return this;
  }

  /**
   *  Resolves a package's dependencies to an array of paths.
   *
   *  @returns {Array}
   *      [ { name, packagePath, packagePath } ]
   */
  async _resolveDependencies(
    initialPackageDir,
    { include = [], exclude = [], deepExclude = [] } = {}
  ) {
    const resolvedDeps = [];
    const cache = {};
    const seperator = `${sep}node_modules${sep}`;

    /**
     *  Resolves packages to their package root directory &
     *  also resolves dependant packages recursively.
     *  - Will also ignore the input package in the results
     */
    const recurse = async (packageDir, _include = [], _exclude = []) => {
      const packageJson = require(path.join(packageDir, './package.json')); // eslint-disable-line

      const { name, dependencies } = packageJson;

      for (const packageName in dependencies) {
        /**
         *  Skips on exclude matches, if set
         *  Skips on include mis-matches, if set
         */
        if (_exclude.length && _exclude.indexOf(packageName) > -1) continue;
        if (_include.length && _include.indexOf(packageName) < 0) continue;

        const resolvedDir = resolvePackage(packageName, { cwd: packageDir });

        if (!resolvedDir) continue;

        const relativePath = path.join('node_modules', resolvedDir.split(`${seperator}`).slice(1).join(seperator));

        if (relativePath in cache) continue;

        cache[relativePath] = true;

        this.log(`[MODULE] ${packageName}`);

        const result = await recurse(resolvedDir, undefined, deepExclude);

        resolvedDeps.push({ ...result, relativePath });
      }

      return {
        name, packagePath: packageDir,
      };
    };

    await recurse(initialPackageDir, include, exclude);

    return resolvedDeps;
  }
}
