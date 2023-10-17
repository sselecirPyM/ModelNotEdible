<template>
  <q-page class="flex justify-center">
    <q-card flat bordered style="width: 320px;">
      <q-btn :label="$t('openFolder')" @click="selectFolder"></q-btn>
      <q-space style="height: 20px;"></q-space>
      <q-scroll-area style="height: 85vh; width: 300px;">
        <q-tree :nodes="rootFile" dense node-key="label" selected-color="blue" default-expand-all @lazy-load="onLazyLoad">
          <template v-slot:default-header="prop">
            <div class="row items-center">
              <q-btn dense no-caps size="xs" flat @dblclick="() => openFile(prop.node.file, prop.node.parentFolder)"
                v-touch-hold.mouse="() => openFile(prop.node.file, prop.node.parentFolder)">
                {{ prop.node.label }}
              </q-btn>
            </div>
          </template>
        </q-tree>
      </q-scroll-area>
    </q-card>
    <q-card flat bordered>
      <q-card-section>
        <CanvasComponent ref="canvas" :objects="objects" @on-init="canvasInit" @on-render="canvasRender" />
      </q-card-section>
      <q-card-section>
        <q-btn :label="$t('resetCamera')" @click="$bus.emit('resetCamera')" />
      </q-card-section>
    </q-card>
    <q-card flat bordered style="width: 300px;">
      <q-card-section>
        <q-btn :label="$t('clear')" @click="clear"></q-btn>
        <q-btn :label="$t('restart')" @click="restart"></q-btn>
      </q-card-section>
      <q-card-section>
        <q-list>
          <q-item v-for="(item, index) in objects" :key="index" clickable v-ripple
            @click="$bus.emit('selectChange', item)">
            <q-item-section>{{ item.label }} </q-item-section>
            <q-popup-proxy>
              <q-card>
                <q-card-section>
                  <div class="row">
                    <q-input dense label="X" class="column" style="width: 55px;" type="number" step="any"
                      v-model.number="item.transform.position[0]" />
                    <q-input dense label="Y" class="column" style="width: 55px;" type="number" step="any"
                      v-model.number="item.transform.position[1]" />
                    <q-input dense label="Z" class="column" style="width: 55px;" type="number" step="any"
                      v-model.number="item.transform.position[2]" />
                  </div>
                </q-card-section>
                <q-card-section style="max-width: 500px;">
                  {{ item.pmx.description }}
                </q-card-section>
                <q-card-section>
                  <q-btn flat @click="item.animation.time = 0" v-close-popup :label="$t('replayAnimation')" />
                </q-card-section>
                <q-card-actions>
                  <q-btn flat @click="resetTransform(item)" v-close-popup>{{ $t('resetTransform') }}</q-btn>
                  <q-btn flat color="red" @click="deleteObject(item)" v-close-popup>{{ $t('delete') }}</q-btn>
                </q-card-actions>
              </q-card>
            </q-popup-proxy>
          </q-item>
        </q-list>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<script>

import { defineComponent, ref } from 'vue'
import CanvasComponent from '../components/CanvasComponent.vue'
import { Pmx } from '../MMD/pmx'
import { Vmd } from 'src/MMD/vmd'


export default defineComponent({
  name: 'IndexPage',
  data() {
    return {
      context: null,
      rootFile: [],
      expanded: [],
      selectedObject: null,
      objects: [],
      step: 0,
      panel: "file"
    };
  },
  components: {
    CanvasComponent
  },
  computed: {
  },
  mounted() {
    this.$bus.on("selectChange", this.selectObjectChange);
  },
  unmounted() {
    this.$bus.off("selectChange", this.selectObjectChange)
  },
  methods: {
    canvasInit(device, canvas) {

    },
    canvasRender(device, context) {

    },

    selectFolder() {
      window.showDirectoryPicker({ id: "model" }).then((fileHandle) => {

        console.log(fileHandle);
        const root = {
          label: fileHandle.name,
          children: [],
          lazy: true,
          file: fileHandle
        }
        this.rootFile = [root];

      }, () => { });
    },
    async showDir(fileHandle) {
      const baseNode = [];
      for await (const value of await fileHandle.values()) {
        const node = {
          label: value.name,
          file: value,
          parentFolder: fileHandle
        };

        if (value.kind == "directory") {
          node.lazy = true;
        }
        baseNode.push(node);
      }
      return baseNode;
    },
    onLazyLoad({ node, key, done, fail }) {
      console.log(node);
      this.showDir(node.file).then((nodes) => {
        done(nodes);
      });
    },
    openFile(file, parentFolder) {
      if (file.kind == "directory") {
        return;
      }
      const a = file.name.substring(file.name.lastIndexOf('.') + 1).toLowerCase();
      if (a == "pmx") {
        this.loadModel(file, parentFolder);
      } else if (a == "vmd") {
        this.loadVmd(file);
      }
    },
    async fillMap(map, basePath, fileHandle) {
      for await (const file of await fileHandle.values()) {
        map.set(basePath + file.name.toLowerCase(), file);
        if (file.kind == "directory") {
          await this.fillMap(map, basePath + file.name.toLowerCase() + '/', file);
        }
      }
    },
    async loadModel(file, parentFolder) {
      const pmx = new Pmx();
      await pmx.load(await file.getFile());
      const map = new Map();
      await this.fillMap(map, '', parentFolder);

      this.objects.push(this.$refs.canvas.createObjectPmx(pmx, map));
    },
    async loadVmd(file) {
      const vmd = new Vmd();
      await vmd.load(await file.getFile());
      if (this.selectedObject) {
        this.selectedObject.vmd = vmd;
      } else if (this.objects[0]) {
        this.objects[0].vmd = vmd;
      }
    },
    selectObjectChange(object) {
      this.selectedObject = object;
    },
    restart() {
      for (const obj of this.objects) {
        obj.animation.time = 0;
      }
    },
    clear() {
      for (const object of this.objects) {
        object.vmd = undefined;
      }
    },
    resetTransform(object) {
      object.transform.position = [0, 0, 0];
      object.transform.rotation = [0, 0, 0, 1];
    },
    deleteObject(object) {
      this.$bus.emit('selectChange', undefined);
      this.$refs.canvas.destroyObjectResource(object);
      this.objects = this.objects.filter((a) => a != object);
    }
  }
})
</script>
