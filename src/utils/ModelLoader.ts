// Utility for loading Vosk models in different environments
export class ModelLoader {
  private static modelCache = new Map<string, any>();

  /**
   * Load a Vosk model with fallback strategies for different environments
   */
  static async loadModel(Vosk: any, modelPath?: string): Promise<any> {
    const finalPath = this.resolveModelPath(modelPath);
    
    // Check cache first
    if (this.modelCache.has(finalPath)) {
      return this.modelCache.get(finalPath);
    }

    try {
      const model = await Vosk.createModel(finalPath);
      this.modelCache.set(finalPath, model);
      return model;
    } catch (error) {
      // Try fallback paths
      const fallbackPaths = this.getFallbackPaths(modelPath);
      
      for (const fallbackPath of fallbackPaths) {
        try {
          console.warn(`Primary model path failed, trying fallback: ${fallbackPath}`);
          const model = await Vosk.createModel(fallbackPath);
          this.modelCache.set(fallbackPath, model);
          return model;
        } catch (fallbackError) {
          console.warn(`Fallback path failed: ${fallbackPath}`, fallbackError);
        }
      }
      
      throw new Error(`Failed to load Vosk model from all attempted paths. Original error: ${error}`);
    }
  }

  private static resolveModelPath(modelPath?: string): string {
    if (modelPath) {
      return modelPath;
    }

    // Default model resolution for different environments
    if (typeof window !== 'undefined') {
      // Browser environment
      return this.getBrowserModelPath();
    } else {
      // Node.js environment (for testing)
      return './vosk-model-small-cn-0.22.zip';
    }
  }

  private static getBrowserModelPath(): string {
    // Always use root directory model file
    return './vosk-model-small-cn-0.22.zip';
  }

  private static getFallbackPaths(originalPath?: string): string[] {
    const fallbacks = [
      // Root directory (primary)
      './vosk-model-small-cn-0.22.zip',
      
      // For built SDK
      './dist/vosk-model-small-cn-0.22.zip',
      '../dist/vosk-model-small-cn-0.22.zip',
      
      // Try different relative paths
      '../vosk-model-small-cn-0.22.zip',
      './assets/vosk-model-small-cn-0.22.zip',
      
      // Try absolute paths
      '/vosk-model-small-cn-0.22.zip',
      '/dist/vosk-model-small-cn-0.22.zip',
      
      // Try npm package paths
      'node_modules/web-voice-kit/dist/vosk-model-small-cn-0.22.zip',
      './node_modules/web-voice-kit/dist/vosk-model-small-cn-0.22.zip',
    ];

    // Remove the original path from fallbacks to avoid duplicate attempts
    return fallbacks.filter(path => path !== originalPath);
  }

  /**
   * Clear the model cache (useful for testing or memory management)
   */
  static clearCache(): void {
    this.modelCache.clear();
  }

  /**
   * Get information about cached models
   */
  static getCacheInfo(): { path: string; cached: boolean }[] {
    return Array.from(this.modelCache.keys()).map(path => ({
      path,
      cached: true
    }));
  }
}
