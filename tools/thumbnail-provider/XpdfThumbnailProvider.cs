using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using Microsoft.Win32;

namespace XpdfShell
{
    [ComVisible(true)]
    [Guid("e357fccd-a995-4576-b01f-234630154e96")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IThumbnailProvider
    {
        [PreserveSig]
        int GetThumbnail(uint cx, out IntPtr phbmp, out uint pdwAlpha);
    }

    [ComVisible(true)]
    [Guid("b725f130-47ef-101a-a5f1-02608c9eebac")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IInitializeWithFile
    {
        void Initialize([MarshalAs(UnmanagedType.LPWStr)] string pszFilePath, uint grfMode);
    }

    [ComVisible(true)]
    [Guid("b824b49d-22ac-4161-ac8a-9916e8fa3f7f")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IInitializeWithStream
    {
        void Initialize(IStream pstream, uint grfMode);
    }

    [ComVisible(true)]
    [Guid("7B8964C3-3E41-4E6E-9762-2D1478B45129")]
    [ClassInterface(ClassInterfaceType.None)]
    [ProgId("XpdfShell.ThumbnailProvider")]
    public class XpdfThumbnailProvider : IThumbnailProvider, IInitializeWithFile, IInitializeWithStream
    {
        private string _filePath;
        private IStream _stream;

        public void Initialize(string pszFilePath, uint grfMode)
        {
            _filePath = pszFilePath;
        }

        public void Initialize(IStream pstream, uint grfMode)
        {
            _stream = pstream;
        }

        public int GetThumbnail(uint cx, out IntPtr phbmp, out uint pdwAlpha)
        {
            phbmp = IntPtr.Zero;
            pdwAlpha = 1; // WTSAT_RGB

            try
            {
                int size = (int)cx;
                if (size <= 0) size = 256;

                // Create a clean thumbnail bitmap
                using (Bitmap bmp = new Bitmap(size, size, PixelFormat.Format32bppArgb))
                using (Graphics g = Graphics.FromImage(bmp))
                {
                    g.SmoothingMode = SmoothingMode.HighQuality;
                    g.InterpolationMode = InterpolationMode.HighQualityBicubic;
                    g.PixelOffsetMode = PixelOffsetMode.HighQuality;
                    g.Clear(Color.Transparent);

                    // Draw stylized PDF page paper background
                    int margin = (int)(size * 0.08f);
                    int pageW = size - (margin * 2);
                    int pageH = (int)(pageW * 1.35f);
                    if (pageH > size - margin * 2)
                    {
                        pageH = size - margin * 2;
                        pageW = (int)(pageH / 1.35f);
                    }

                    int pageX = (size - pageW) / 2;
                    int pageY = (size - pageH) / 2;

                    Rectangle pageRect = new Rectangle(pageX, pageY, pageW, pageH);

                    // Paper drop shadow
                    using (SolidBrush shadowBrush = new SolidBrush(Color.FromArgb(40, 0, 0, 0)))
                    {
                        g.FillRectangle(shadowBrush, new Rectangle(pageX + 3, pageY + 3, pageW, pageH));
                    }

                    // White paper fill
                    using (SolidBrush paperBrush = new SolidBrush(Color.White))
                    {
                        g.FillRectangle(paperBrush, pageRect);
                    }

                    // Paper border
                    using (Pen borderPen = new Pen(Color.FromArgb(200, 210, 220), 1.5f))
                    {
                        g.DrawRectangle(borderPen, pageRect);
                    }

                    // Draw stylized document text lines inside paper
                    int lineMargin = (int)(pageW * 0.12f);
                    int lineW = pageW - (lineMargin * 2);
                    int lineY = pageY + (int)(pageH * 0.18f);

                    // Title header bar inside document
                    using (SolidBrush titleBarBrush = new SolidBrush(Color.FromArgb(220, 230, 242)))
                    {
                        g.FillRectangle(titleBarBrush, new Rectangle(pageX + lineMargin, pageY + (int)(pageH * 0.08f), (int)(lineW * 0.6f), (int)(pageH * 0.05f)));
                    }

                    // Body lines
                    using (SolidBrush lineBrush = new SolidBrush(Color.FromArgb(235, 238, 245)))
                    {
                        for (int i = 0; i < 7; i++)
                        {
                            int curY = lineY + (i * (int)(pageH * 0.07f));
                            if (curY + 5 > pageY + pageH - (int)(pageH * 0.25f)) break;
                            float widthFactor = (i % 3 == 0) ? 0.75f : ((i % 2 == 0) ? 0.9f : 1.0f);
                            g.FillRectangle(lineBrush, new Rectangle(pageX + lineMargin, curY, (int)(lineW * widthFactor), Math.Max(2, (int)(pageH * 0.035f))));
                        }
                    }

                    // Draw XPDF Logo badge at Bottom-Right Corner
                    string logoPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "logo.png");
                    if (!File.Exists(logoPath))
                    {
                        string appDataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "XPDF Editor", "resources", "build", "icon.png");
                        if (File.Exists(appDataDir)) logoPath = appDataDir;
                    }

                    int badgeSize = (int)(size * 0.36f);
                    int badgeX = pageX + pageW - badgeSize + (int)(margin * 0.4f);
                    int badgeY = pageY + pageH - badgeSize + (int)(margin * 0.4f);

                    if (File.Exists(logoPath))
                    {
                        using (Image logoImg = Image.FromFile(logoPath))
                        {
                            // Badge glow shadow
                            using (SolidBrush badgeShadow = new SolidBrush(Color.FromArgb(50, 0, 0, 0)))
                            {
                                g.FillEllipse(badgeShadow, badgeX - 2, badgeY - 2, badgeSize + 4, badgeSize + 4);
                            }

                            // Badge background circle
                            using (SolidBrush badgeBg = new SolidBrush(Color.White))
                            {
                                g.FillEllipse(badgeBg, badgeX, badgeY, badgeSize, badgeSize);
                            }
                            using (Pen badgeBorder = new Pen(Color.FromArgb(220, 230, 242), 1.5f))
                            {
                                g.DrawEllipse(badgeBorder, badgeX, badgeY, badgeSize, badgeSize);
                            }

                            // Draw logo inside badge
                            int pad = (int)(badgeSize * 0.15f);
                            g.DrawImage(logoImg, new Rectangle(badgeX + pad, badgeY + pad, badgeSize - (pad * 2), badgeSize - (pad * 2)));
                        }
                    }
                    else
                    {
                        // Built-in vector logo badge
                        using (SolidBrush badgeBg = new SolidBrush(Color.FromArgb(14, 165, 233))) // Sky blue
                        {
                            g.FillEllipse(badgeBg, badgeX, badgeY, badgeSize, badgeSize);
                        }
                        using (SolidBrush textBrush = new SolidBrush(Color.White))
                        using (Font font = new Font(FontFamily.GenericSansSerif, badgeSize * 0.35f, FontStyle.Bold))
                        using (StringFormat sf = new StringFormat { Alignment = StringAlignment.Center, LineAlignment = StringAlignment.Center })
                        {
                            g.DrawString("XPDF", font, textBrush, new RectangleF(badgeX, badgeY, badgeSize, badgeSize), sf);
                        }
                    }

                    phbmp = bmp.GetHbitmap();
                    return 0; // S_OK
                }
            }
            catch (Exception)
            {
                return -2147467259; // E_FAIL
            }
        }

        [ComRegisterFunction]
        public static void Register(Type t)
        {
            try
            {
                string clsid = t.GUID.ToString("B");

                // Register ShellEx Thumbnail Handler for .pdf
                using (RegistryKey key = Registry.ClassesRoot.CreateSubKey(@".pdf\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}"))
                {
                    if (key != null) key.SetValue("", clsid);
                }

                // Register CLSID flags
                using (RegistryKey clsidKey = Registry.ClassesRoot.CreateSubKey(string.Format(@"CLSID\{0}", clsid)))
                {
                    if (clsidKey != null)
                    {
                        clsidKey.SetValue("", "XPDF Shell Thumbnail Handler");
                        clsidKey.SetValue("DisableProcessIsolation", 1, RegistryValueKind.DWord);
                    }
                }
            }
            catch (Exception ex)
            {
                Console.WriteLine("Register error: " + ex.Message);
            }
        }

        [ComUnregisterFunction]
        public static void Unregister(Type t)
        {
            try
            {
                Registry.ClassesRoot.DeleteSubKeyTree(@".pdf\ShellEx\{e357fccd-a995-4576-b01f-234630154e96}", false);
            }
            catch (Exception) { }
        }
    }
}
