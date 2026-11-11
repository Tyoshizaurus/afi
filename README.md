# afi

スマホのブラウザで使える画像生成ツール（PWA）。ビルド不要の静的ファイルだけで動きます。

## 機能

- プロンプトを入力して画像を生成（1〜4枚、縦横比 1:1 / 3:4 / 9:16 / 4:3 / 16:9）
- 生成サービスを切り替え
  - **Pollinations** … 無料・APIキー不要（まず試すならこれ）
  - **OpenAI**（`gpt-image-1`）… 要 APIキー
  - **Google Imagen**（`imagen-4.0-generate-001`）… 要 Gemini APIキー
- 生成した画像は端末内（IndexedDB）にギャラリーとして保存
- 共有（スマホの共有シート）・保存・プロンプト再利用・削除
- ホーム画面に追加するとアプリのように全画面で起動

APIキーは端末のブラウザ（localStorage）にだけ保存され、各サービスに直接送信されます。
モデル名は右上の ⚙︎ から変更できます。

## スマホで使う

1. GitHub の **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする
2. `main` に push すると `.github/workflows/pages.yml` で自動公開される
3. 公開された URL をスマホで開き、「ホーム画面に追加」

## ローカルで試す

```sh
python3 -m http.server 8000
# → http://localhost:8000
```

同じ Wi-Fi のスマホからは `http://<PCのIPアドレス>:8000` で開けます。
