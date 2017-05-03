rm -r dist/*
npm run build
git checkout gh-pages
rm index.js
rm *.worker.js
rm worker.js
rm bundle.css
cp dist/* .
rm placeholder.png
git add .
git commit -am "update"
git push
git checkout master
