using System;
using System.IO;
using System.Drawing;
using System.Drawing.Imaging;
using System.Threading.Tasks;
using Windows.Data.Pdf;
using Windows.Storage;
using Windows.Storage.Streams;

class Program
{
    static void Main(string[] args)
    {
        try
        {
            string pdfPath = @"C:\Users\burha\Desktop\analizler\65890.pdf";
            if (!File.Exists(pdfPath))
            {
                var files = Directory.GetFiles(@"C:\Users\burha\Desktop", "*.pdf", SearchOption.AllDirectories);
                if (files.Length > 0) pdfPath = files[0];
            }
            Console.WriteLine("PDF: " + pdfPath);
            RenderPdfFirstPage(pdfPath, @"C:\Users\burha\Desktop\test_thumb.png").Wait();
            Console.WriteLine("Success: test_thumb.png generated!");
        }
        catch (Exception ex)
        {
            Console.WriteLine("Error: " + ex);
        }
    }

    static async Task RenderPdfFirstPage(string pdfPath, string outputPath)
    {
        StorageFile file = await StorageFile.GetFileFromPathAsync(pdfPath);
        PdfDocument doc = await PdfDocument.LoadFromFileAsync(file);
        if (doc.PageCount == 0) return;

        using (PdfPage page = doc.GetPage(0))
        {
            var stream = new InMemoryRandomAccessStream();
            var options = new PdfPageRenderOptions();
            options.DestinationWidth = 512;
            options.DestinationHeight = (uint)(512 * (page.Size.Height / page.Size.Width));
            await page.RenderToStreamAsync(stream, options);

            using (Stream netStream = stream.AsStream())
            using (Image img = Image.FromStream(netStream))
            {
                img.Save(outputPath, ImageFormat.Png);
            }
        }
    }
}
