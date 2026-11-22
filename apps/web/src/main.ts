import {createApp} from 'vue';
import {createRouter,createWebHistory} from 'vue-router';
import App from './App.vue';
import Doushouqi from './pages/DoushouqiPlay.vue';
import './style.css';
const router=createRouter({history:createWebHistory(),routes:[{path:'/',component:Doushouqi},{path:'/games/dou-shou-qi',component:Doushouqi},{path:'/:pathMatch(.*)*',redirect:'/'}]});
createApp(App).use(router).mount('#app');
