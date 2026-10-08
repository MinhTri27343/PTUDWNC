import express from 'express';
import { application, ports } from './common.js';
const { app } = application('web');
app.use(express.static('public', { etag: false, maxAge: 0 }));
app.listen(ports.web, '127.0.0.1', () => console.log(`web ready ${ports.web}`));
