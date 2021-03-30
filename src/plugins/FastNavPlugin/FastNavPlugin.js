import {Plugin} from "../../viewer/Plugin.js";

/**
 * {@link Viewer} plugin that improves interactivity by disabling expensive rendering effects while the {@link Camera} is moving.
 *
* # Usage
 *
 * In the example below, we'll create a {@link Viewer}, add a {@link FastNavPlugin}, then use a {@link  XKTLoaderPlugin} to load a model.
 *
* This viewer will only render the model with physically-based rendering (PBR) and scalable ambient obscurance (SAO) when the camera is not moving.
 *
 * ````javascript
 * import {Viewer} from "../src/viewer/Viewer.js";
 * import {XKTLoaderPlugin} from "../src/plugins/XKTLoaderPlugin/XKTLoaderPlugin.js";
 * import {FastNavPlugin} from "../src/plugins/FastNavPlugin/FastNavPlugin.js";
 *
 * const viewer = new Viewer({
 *      canvasId: "myCanvas",
 *      transparent: true,
 *      pbrEnabled: true,
 *      saoEnabled: true
 *  });
 *
 * viewer.camera.eye = [7.31, 2.79, 6.12];
 * viewer.camera.look = [2.80, 0.15, 1.83];
 * viewer.camera.up = [-0.28, 0.92, -0.26];
 *
 * new FastNavPlugin(viewer, {});
 *
 * const xktLoader = new XKTLoaderPlugin(viewer);
 *
 * const model = xktLoader.load({
 *      id: "myModel",
 *      src: "./models/xkt/gearboxPropellorTurbine/gearboxPropellorTurbine.xkt",
 *      edges: true,
 *      saoEnabled: true,
 *      pbrEnabled: true
 * });
 * ````
 *
 * @class FastNavPlugin
 */
class FastNavPlugin extends Plugin {

    constructor(viewer) {

        super("FastNav", viewer);

        this._pInterval = null;
        this._fadeMillisecs = 500;

        let timeoutDuration = 600; // Milliseconds
        let timer = timeoutDuration;
        let fastMode = false;

        this._onCameraMatrix = viewer.scene.camera.on("matrix", () => {
            timer = timeoutDuration;
            if (!fastMode) {
                this._cancelFade();
                viewer.scene.pbrEnabled = false;
                viewer.scene.sao.enabled = false;
                viewer.scene.edgeMaterial.edges = false;
                fastMode = true;
            }
        });

        this._onSceneTick = viewer.scene.on("tick", (tickEvent) => {  // Milliseconds
            if (!fastMode) {
                return;
            }
            timer -= tickEvent.deltaTime;
            if (timer <= 0) {
                if (fastMode) {
                    this._startFade();
                    viewer.scene.pbrEnabled = true;
                    viewer.scene.sao.enabled = true;
                    viewer.scene.edgeMaterial.edges = true;
                    fastMode = false;
                }
            }
        });
    }

    _startFade() {

        if (!this._img) {
            this._initFade();
        }

        const interval = 50;
        const inc = 1 / (this._fadeMillisecs / interval);

        if (this._pInterval) {
            clearInterval(this._pInterval);
            this._pInterval = null;
        }

        const canvas = this.viewer.scene.canvas.canvas;
        const zIndex = (parseInt(canvas.style["z-index"]) || 0) + 1;

        this._img.style.position = "absolute";
        this._img.style["z-index"] = zIndex;
        this._img.style.left = canvas.style.left;
        this._img.style.top = canvas.style.top;
        this._img.style.width = canvas.style.width;
        this._img.style.height = canvas.style.height;
        this._img.style.opacity = 1;
        this._img.width = canvas.width;
        this._img.height = canvas.height;
        this._img.src = this.viewer.getSnapshot({format: "png"});
        this._img.style.visibility = "visible";

        let opacity = 1;
        this._pInterval = setInterval(() => {
            opacity -= inc;
            if (opacity > 0) {
                this._img.style.opacity = opacity;
            } else {
                this._img.style.opacity = 0;
                this._img.style.visibility = "hidden";
                clearInterval(this._pInterval);
                this._pInterval = null;
            }
        }, interval);
    }

    _initFade() {
        const body = document.getElementsByTagName("body")[0];
        this._img = document.createElement('img');
        const canvas = this.viewer.scene.canvas.canvas;
        const zIndex = (parseInt(canvas.style["z-index"]) || 0) + 1;
        this._img.style.position = "absolute";
        this._img.style.visibility = "hidden";
        this._img.style["pointer-events"] = "none";
        this._img.style["z-index"] = zIndex;
        this._img.style.left = canvas.style.left;
        this._img.style.top = canvas.style.top;
        this._img.style.width = canvas.style.width;
        this._img.style.height = canvas.style.height;
        this._img.style.opacity = 0;
        this._img.width = canvas.width;
        this._img.height = canvas.height;
        body.appendChild(this._img);
    }

    _cancelFade() {
        if (!this._img) {
            return;
        }
        if (this._pInterval) {
            clearInterval(this._pInterval);
            this._pInterval = null;
        }
        this._img.style.opacity = 0;
        this._img.style.visibility = "hidden";
    }

    /**
     * @private
     */
    send(name, value) {
        switch (name) {
            case "clear":
                this._cancelFade();
                break;
        }
    }

    /**
     * Destroys this plugin.
     */
    destroy() {
        this._cancelFade();
        this.viewer.scene.camera.off(this._onCameraMatrix);
        this.viewer.scene.off(this._onSceneTick);
        super.destroy();
        this._img.parentNode.removeChild(this._img);
        this._img = null;
    }
}

export {FastNavPlugin}
