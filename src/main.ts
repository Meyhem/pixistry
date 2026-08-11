import './style.css';
import { mountApp } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app root element');
mountApp(root);
